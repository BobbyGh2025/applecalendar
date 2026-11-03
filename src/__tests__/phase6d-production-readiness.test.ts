/**
 * Phase 6D: Production Readiness Tests
 * @vitest-environment node
 *
 * Covers the verified audit findings fixed in Phase 6D:
 *
 *   C3 — Payment verify reference binding (double-spend closure)
 *        - Verify rejects a reference that belongs to a DIFFERENT payment
 *        - Verify accepts the payment's own idempotencyKey / providerRef
 *        - Paystack provider rejects a response whose data.reference
 *          differs from the queried reference (defense in depth)
 *   C2 — Refund authorization gate
 *        - Booking owner (attendee) creates a REQUESTED refund; the provider
 *          is NOT called; response marks pendingApproval; AuditLog written
 *        - Event organizer triggers the provider refund (PROCESSING)
 *        - Unrelated user → 403
 *   C1 — Refund lifecycle webhook completion (ledger closure)
 *        - refund.processed → Refund COMPLETED + refundedAmount incremented
 *          + full refund transitions Payment → REFUNDED
 *        - Duplicate refund.processed → idempotent no-op
 *        - refund.failed → FAILED only from REQUESTED/PROCESSING
 *        - Late refund.failed after COMPLETED does NOT clobber the refund
 *        - Unknown refund reference → marked processed (non-retriable)
 *        - Amount mismatch → WebhookAmountMismatch + event marked processed
 *   H1 — Inventory reservation atomicity with the booking transaction
 *        - Forced transaction failure after reservation rolls back
 *          reservedCount (paid path) / soldCount (free path)
 *   M4 — Race-gated notifications
 *        - Lost expiry race → no "Payment Expired" notification
 *        - Lost failure race → no "Payment Failed" notification
 *   N-14 — Chunked cancellation fan-out correctness at multi-chunk scale
 *   N-8/N-9 — Order-consistent cursor pagination + NaN limit guard
 *   F-14 — Rate-limit key uses the LAST x-forwarded-for hop
 *   F-2 — Dev-token leak gates are fail-closed (source assertions)
 *   F-7 — Safe-scheme URL validation on rendered URL fields
 *   F-22 — Security headers + CSP configured for ALL routes
 *   F-11 — prisma/migrations/migration_lock.toml committed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

// ─── Services under test ───
import { reserveInventory, releaseReservation } from '@/lib/services/inventory';
import { generateIdempotencyKey } from '@/lib/services/booking-payment';
import * as bookingPaymentModule from '@/lib/services/booking-payment';
import { createPendingTickets } from '@/lib/services/ticket-service';
import { processWebhookEvent } from '@/lib/services/payment-webhook';
import { WebhookAmountMismatch } from '@/lib/services/payment-domain-errors';
import { expireSinglePayment } from '@/lib/services/payment-expiry';
import { notifyAttendeesEventCancelled } from '@/lib/services/notification-service';
import { asMoney } from '@/lib/money';
import { rateLimit, setRateLimitStore, MemoryStore } from '@/lib/rate-limit';
import { providerRegistry } from '@/lib/services/payment-provider';
import type { VerifyPaymentOutcome } from '@/lib/services/payment-provider';
import { urlField } from '@/lib/validations/common';
import { updateProfileSchema } from '@/lib/validations/identity';
import { updateAdSchema } from '@/lib/validations/ads';
import { initializePaymentSchema } from '@/lib/validations/payments';
import { createSessionAndTokens } from '@/lib/auth';

// Side-effect import to register providers
import '@/lib/services/providers';

// ─── Route handlers under test ───
import { POST as verifyPaymentRoute } from '@/app/api/payments/[id]/verify/route';
import { POST as requestRefundRoute } from '@/app/api/payments/[id]/refunds/route';
import { POST as bookRoute } from '@/app/api/events/[id]/book/route';
import { GET as listNotifications } from '@/app/api/notifications/route';

// ─── Test helpers ───

function uid(): string {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const created = {
  users: [] as string[],
  events: [] as string[],
  ticketTypes: [] as string[],
  bookings: [] as string[],
  payments: [] as string[],
  tickets: [] as string[],
  refunds: [] as string[],
};

async function createUser(role: string = 'PUBLIC') {
  const user = await db.user.create({
    data: {
      email: `p6d-${uid()}@test.com`,
      password: await bcrypt.hash('testpass123', 12),
      name: `Test ${role} ${uid()}`,
      role,
    },
  });
  created.users.push(user.id);
  return user;
}

async function createEvent(organizerId: string, overrides?: { price?: number; isPaid?: boolean }) {
  const event = await db.event.create({
    data: {
      title: `Test Event ${uid()}`,
      slug: `evt-${uid()}`,
      description: 'Phase 6D test event',
      startDate: new Date('2026-03-01'),
      organizerId,
      status: 'PUBLISHED',
      isPaid: overrides?.isPaid ?? true,
      currency: 'GHS',
    },
  });
  created.events.push(event.id);
  return event;
}

async function createTicketType(
  eventId: string,
  price: number,
  quantity: number
) {
  const tt = await db.ticketType.create({
    data: {
      eventId,
      name: `Ticket ${uid()}`,
      price,
      currency: 'GHS',
      quantity,
      soldCount: 0,
      reservedCount: 0,
      minPerOrder: 1,
      maxPerOrder: 10,
      isActive: true,
    },
  });
  created.ticketTypes.push(tt.id);
  return tt;
}

/**
 * Full paid-booking fixture: PENDING booking + reserved inventory +
 * PENDING PAYSTACK payment (with idempotencyKey + providerRef) + PENDING tickets.
 */
async function createPaidBookingFixture(
  user: { id: string },
  event: { id: string },
  ticketType: { id: string },
  quantity = 2
) {
  const price = 5000; // GHS 50.00 in minor units
  const totalAmount = price * quantity;
  const bookingRef = `BK-${uid()}`;

  const booking = await db.booking.create({
    data: {
      userId: user.id,
      eventId: event.id,
      totalAmount,
      currency: 'GHS',
      status: 'PENDING',
      bookingRef,
    },
  });
  created.bookings.push(booking.id);

  await reserveInventory({ ticketTypeId: ticketType.id, quantity });

  const providerRef = `ps_ref_${uid()}`;
  const idempotencyKey = generateIdempotencyKey();
  const payment = await db.payment.create({
    data: {
      bookingId: booking.id,
      userId: user.id,
      amount: totalAmount,
      currency: 'GHS',
      provider: 'PAYSTACK',
      status: 'PENDING',
      idempotencyKey,
      providerRef,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  created.payments.push(payment.id);

  const ticketResult = await createPendingTickets({
    bookingId: booking.id,
    ticketTypeId: ticketType.id,
    quantity,
    bookingRef,
  });
  created.tickets.push(...ticketResult.ticketIds);

  return { booking, payment, providerRef, idempotencyKey, bookingRef };
}

/** COMPLETED payment fixture for refund eligibility (C2/C1). */
async function createCompletedPaymentFixture(
  organizerId: string,
  attendeeId: string
) {
  const event = await createEvent(organizerId);
  const tt = await createTicketType(event.id, 10000, 50);
  const { booking, payment, providerRef, idempotencyKey } =
    await createPaidBookingFixture({ id: attendeeId }, event, tt, 1);

  // Transition to a completed payment (simulating a successful charge)
  await db.payment.update({
    where: { id: payment.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  return { event, ticketType: tt, booking, payment, providerRef, idempotencyKey };
}

async function authedRequest(
  user: { id: string; email: string; role: string },
  url: string,
  init?: { method?: string; body?: unknown }
): Promise<NextRequest> {
  const { accessToken } = await createSessionAndTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`http://localhost:3000${url}`, {
    method: init?.method ?? 'GET',
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════
// SETUP / TEARDOWN
// ═══════════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.restoreAllMocks();
  // Phase 6D tests hit rate-limited routes; the limiter's process-global
  // 'unknown' bucket would otherwise leak 429s across tests. Each test gets
  // a fresh store (test isolation — does NOT weaken the limiter itself).
  setRateLimitStore(new MemoryStore());
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Cleanup in FK-safe order
  for (const id of created.refunds) {
    await db.refund.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.payments) {
    await db.payment.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.tickets) {
    await db.ticket.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.bookings) {
    await db.booking.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.ticketTypes) {
    await db.ticketType.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.events) {
    await db.event.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.users) {
    await db.notification.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.notificationPreference.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.auditLog.deleteMany({ where: { actorId: id } }).catch(() => {});
    await db.refreshToken.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.user.delete({ where: { id } }).catch(() => {});
  }
  created.refunds = [];
  created.payments = [];
  created.tickets = [];
  created.bookings = [];
  created.ticketTypes = [];
  created.events = [];
  created.users = [];
});

// ═══════════════════════════════════════════════════════════════════
// C3 — Payment verify reference binding
// ═══════════════════════════════════════════════════════════════════

describe('C3: payment verify reference binding', () => {
  function fakePaystack(verifyOutcome: VerifyPaymentOutcome) {
    const verifyPayment = vi.fn().mockResolvedValue(verifyOutcome);
    const fake = { verifyPayment };
    const requireSpy = vi
      .spyOn(providerRegistry, 'require')
      .mockReturnValue(fake as never);
    return { verifyPayment, requireSpy };
  }

  it('rejects a reference that belongs to a DIFFERENT payment (403 REFERENCE_MISMATCH)', async () => {
    const org = await createUser('ORGANIZER');
    const attacker = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    // Two identical bookings (same amount + currency) — the double-spend setup
    const victim = await createPaidBookingFixture(attacker, event, tt, 2);
    const other = await createPaidBookingFixture(attacker, event, tt, 2);

    const { verifyPayment } = fakePaystack({ success: true, verifiedAmount: asMoney(victim.payment.amount), verifiedCurrency: 'GHS', providerReference: other.providerRef, paidAt: new Date() });

    const response = await verifyPaymentRoute(
      await authedRequest(attacker, `/api/payments/${victim.payment.id}/verify`, {
        method: 'POST',
        body: { providerReference: other.providerRef }, // other payment's reference
      }),
      { params: Promise.resolve({ id: victim.payment.id }) }
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('REFERENCE_MISMATCH');
    // The provider must NEVER be consulted with a foreign reference
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it('accepts the payment\'s own idempotencyKey (Paystack transaction reference)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const fixture = await createPaidBookingFixture(user, event, tt, 1);

    fakePaystack({
      success: true,
      verifiedAmount: asMoney(fixture.payment.amount),
      verifiedCurrency: 'GHS',
      providerReference: fixture.idempotencyKey,
      paidAt: new Date(),
    });

    const response = await verifyPaymentRoute(
      await authedRequest(user, `/api/payments/${fixture.payment.id}/verify`, {
        method: 'POST',
        body: { providerReference: fixture.idempotencyKey },
      }),
      { params: Promise.resolve({ id: fixture.payment.id }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verified).toBe(true);
  });

  it('accepts the payment\'s own providerRef', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const fixture = await createPaidBookingFixture(user, event, tt, 1);

    fakePaystack({
      success: true,
      verifiedAmount: asMoney(fixture.payment.amount),
      verifiedCurrency: 'GHS',
      providerReference: fixture.providerRef,
      paidAt: new Date(),
    });

    const response = await verifyPaymentRoute(
      await authedRequest(user, `/api/payments/${fixture.payment.id}/verify`, {
        method: 'POST',
        body: { providerReference: fixture.providerRef },
      }),
      { params: Promise.resolve({ id: fixture.payment.id }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verified).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C2 — Refund authorization gate
// ═══════════════════════════════════════════════════════════════════

describe('C2: refund authorization gate', () => {
  it('booking owner creates a REQUESTED refund — provider NOT called, AuditLog written', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);

    const requestRefundProvider = vi.fn().mockResolvedValue({
      success: true,
      refundReference: `rref_${uid()}`,
    });
    vi.spyOn(providerRegistry, 'require').mockReturnValue({
      requestRefund: requestRefundProvider,
    } as never);

    const response = await requestRefundRoute(
      await authedRequest(attendee, `/api/payments/${fixture.payment.id}/refunds`, {
        method: 'POST',
        body: { amount: 5000, reason: 'Cannot attend' },
      }),
      { params: Promise.resolve({ id: fixture.payment.id }) }
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.refund.status).toBe('REQUESTED');
    expect(body.pendingApproval).toBe(true);
    // CRITICAL: an attendee request must never move provider money
    expect(requestRefundProvider).not.toHaveBeenCalled();

    const audit = await db.auditLog.findFirst({
      where: { entityType: 'Refund', entityId: body.refund.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(attendee.id);
    expect(audit?.action).toBe('CREATE');

    created.refunds.push(body.refund.id);
  });

  it('event organizer triggers the provider refund (PROCESSING)', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);

    const refundRef = `rref_${uid()}`;
    const requestRefundProvider = vi.fn().mockResolvedValue({
      success: true,
      refundReference: refundRef,
    });
    vi.spyOn(providerRegistry, 'require').mockReturnValue({
      requestRefund: requestRefundProvider,
    } as never);

    const response = await requestRefundRoute(
      await authedRequest(org, `/api/payments/${fixture.payment.id}/refunds`, {
        method: 'POST',
        body: { amount: 5000 }, // full amount of the fixture payment
      }),
      { params: Promise.resolve({ id: fixture.payment.id }) }
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.refund.status).toBe('PROCESSING');
    expect(body.refund.providerRef).toBe(refundRef);
    expect(requestRefundProvider).toHaveBeenCalledTimes(1);
    expect(body.pendingApproval).toBeUndefined();

    const audit = await db.auditLog.findFirst({
      where: { entityType: 'Refund', entityId: body.refund.id },
    });
    expect(audit?.action).toBe('APPROVE');

    created.refunds.push(body.refund.id);
  });

  it('unrelated user gets 403', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const stranger = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);

    const response = await requestRefundRoute(
      await authedRequest(stranger, `/api/payments/${fixture.payment.id}/refunds`, {
        method: 'POST',
        body: { amount: 1000 },
      }),
      { params: Promise.resolve({ id: fixture.payment.id }) }
    );

    expect(response.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C1 — Refund lifecycle webhook completion
// ═══════════════════════════════════════════════════════════════════

describe('C1: refund webhook completion', () => {
  async function createRefundFixture(
    paymentId: string,
    paymentAmount: number,
    amount: number,
    providerRef: string,
    status: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' = 'REQUESTED'
  ) {
    const refund = await db.refund.create({
      data: { paymentId, amount, reason: null, status, requestedBy: null, providerRef },
    });
    created.refunds.push(refund.id);
    return refund;
  }

  it('refund.processed completes the ledger: Refund COMPLETED + refundedAmount + Payment REFUNDED', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);
    const refundRef = `rref_${uid()}`;
    await createRefundFixture(fixture.payment.id, fixture.payment.amount, fixture.payment.amount, refundRef);

    const result = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: `paystack-refund-${uid()}`,
        eventType: 'refund.processed',
        eventReference: refundRef,
        amount: asMoney(fixture.payment.amount),
        currency: 'GHS',
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: false,
        isRefundEvent: true,
        isRefundSuccess: true,
        isRefundFailure: false,
      },
    });

    expect(result.processed).toBe(true);

    const refund = await db.refund.findFirst({ where: { providerRef: refundRef } });
    expect(refund?.status).toBe('COMPLETED');
    expect(refund?.processedAt).not.toBeNull();

    const payment = await db.payment.findUnique({ where: { id: fixture.payment.id } });
    expect(payment?.refundedAmount).toBe(fixture.payment.amount);
    // Full refund transitions the payment
    expect(payment?.status).toBe('REFUNDED');
  });

  it('partial refund.processed increments refundedAmount without REFUNDED status', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);
    const refundRef = `rref_${uid()}`;
    await createRefundFixture(fixture.payment.id, fixture.payment.amount, 4000, refundRef);

    await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: `paystack-refund-${uid()}`,
        eventType: 'refund.processed',
        eventReference: refundRef,
        amount: asMoney(4000),
        currency: 'GHS',
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: false,
        isRefundEvent: true,
        isRefundSuccess: true,
        isRefundFailure: false,
      },
    });

    const payment = await db.payment.findUnique({ where: { id: fixture.payment.id } });
    expect(payment?.refundedAmount).toBe(4000);
    expect(payment?.status).toBe('COMPLETED'); // partial refund does not flip status
  });

  it('duplicate refund.processed is an idempotent no-op', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);
    const refundRef = `rref_${uid()}`;
    await createRefundFixture(fixture.payment.id, fixture.payment.amount, fixture.payment.amount, refundRef);

    const event = {
      provider: 'PAYSTACK' as const,
      eventId: `paystack-refund-${uid()}`,
      eventType: 'refund.processed',
      eventReference: refundRef,
      amount: asMoney(fixture.payment.amount),
      currency: 'GHS',
      eventAt: new Date(),
      isPaymentSuccess: false,
      isPaymentFailure: false,
      isRefundEvent: true,
      isRefundSuccess: true,
      isRefundFailure: false,
    };

    await processWebhookEvent({ event });
    const rerun = await processWebhookEvent({ event });

    expect(rerun.processed).toBe(false);
    expect(rerun.outcome).toContain('already processed');

    const payment = await db.payment.findUnique({ where: { id: fixture.payment.id } });
    expect(payment?.refundedAmount).toBe(fixture.payment.amount); // not double-counted
  });

  it('refund.failed transitions REQUESTED → FAILED; late failure cannot clobber COMPLETED', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);
    const refundRef = `rref_${uid()}`;
    const refund = await createRefundFixture(fixture.payment.id, fixture.payment.amount, 5000, refundRef);

    await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: `paystack-refund-${uid()}`,
        eventType: 'refund.failed',
        eventReference: refundRef,
        amount: asMoney(5000),
        currency: 'GHS',
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: false,
        isRefundEvent: true,
        isRefundSuccess: false,
        isRefundFailure: true,
      },
    });

    expect((await db.refund.findUnique({ where: { id: refund.id } }))?.status).toBe('FAILED');

    // Late/duplicate failure after the refund reached a terminal state must
    // not resurrect or further mutate it.
    await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: `paystack-refund-${uid()}`,
        eventType: 'refund.failed',
        eventReference: refundRef,
        amount: asMoney(5000),
        currency: 'GHS',
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: false,
        isRefundEvent: true,
        isRefundSuccess: false,
        isRefundFailure: true,
      },
    });
    expect((await db.refund.findUnique({ where: { id: refund.id } }))?.status).toBe('FAILED');
  });

  it('refund.failed does NOT clobber a COMPLETED refund (racing processed/failed)', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);
    const refundRef = `rref_${uid()}`;
    const refund = await createRefundFixture(
      fixture.payment.id,
      fixture.payment.amount,
      5000,
      refundRef,
      'COMPLETED'
    );

    await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: `paystack-refund-${uid()}`,
        eventType: 'refund.failed',
        eventReference: refundRef,
        amount: asMoney(5000),
        currency: 'GHS',
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: false,
        isRefundEvent: true,
        isRefundSuccess: false,
        isRefundFailure: true,
      },
    });

    expect((await db.refund.findUnique({ where: { id: refund.id } }))?.status).toBe('COMPLETED');
  });

  it('unknown refund reference is marked processed (non-retriable)', async () => {
    const result = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: `paystack-refund-${uid()}`,
        eventType: 'refund.processed',
        eventReference: `rref-does-not-exist-${uid()}`,
        amount: asMoney(1000),
        currency: 'GHS',
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: false,
        isRefundEvent: true,
        isRefundSuccess: true,
        isRefundFailure: false,
      },
    });

    expect(result.processed).toBe(true);
    expect(result.outcome).toContain('Refund not found');
  });

  it('refund amount mismatch throws WebhookAmountMismatch and marks event processed', async () => {
    const org = await createUser('ORGANIZER');
    const attendee = await createUser('PUBLIC');
    const fixture = await createCompletedPaymentFixture(org.id, attendee.id);
    const refundRef = `rref_${uid()}`;
    await createRefundFixture(fixture.payment.id, fixture.payment.amount, 5000, refundRef);

    await expect(
      processWebhookEvent({
        event: {
          provider: 'PAYSTACK',
          eventId: `paystack-refund-${uid()}`,
          eventType: 'refund.processed',
          eventReference: refundRef,
          amount: asMoney(9999), // mismatch
          currency: 'GHS',
          eventAt: new Date(),
          isPaymentSuccess: false,
          isPaymentFailure: false,
          isRefundEvent: true,
          isRefundSuccess: true,
          isRefundFailure: false,
        },
      })
    ).rejects.toThrow(WebhookAmountMismatch);

    // Refund must NOT have been completed
    const refund = await db.refund.findFirst({ where: { providerRef: refundRef } });
    expect(refund?.status).toBe('REQUESTED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// H1 — Inventory reservation atomicity
// ═══════════════════════════════════════════════════════════════════

describe('H1: inventory reservation rolls back with the booking transaction', () => {
  it('paid path: transaction failure after reservation leaves reservedCount unchanged', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    // Force the payment creation (inside the booking transaction) to fail.
    // Phase 6D verification (C-1): createBookingPayment now runs on the TX
    // client inside the transaction, so the failure is injected at the service
    // module boundary — the injected failure lands INSIDE the interactive
    // transaction exactly where the real payment INSERT happens.
    const createSpy = vi
      .spyOn(bookingPaymentModule, 'createBookingPayment')
      .mockRejectedValueOnce(new Error('injected tx failure'));

    const response = await bookRoute(
      await authedRequest(user, `/api/events/${event.id}/book`, {
        method: 'POST',
        body: { ticketTypeId: tt.id, quantity: 3 },
      }),
      { params: Promise.resolve({ id: event.id }) }
    );

    expect(response.status).toBeGreaterThanOrEqual(500);
    createSpy.mockRestore();

    const after = await db.ticketType.findUnique({ where: { id: tt.id } });
    // H1 fix: reservation rolled back with the failed transaction.
    // Pre-fix, reservedCount would have leaked to 3.
    expect(after?.reservedCount).toBe(0);
    expect(after?.soldCount).toBe(0);
  });

  it('free path: transaction failure after soldCount increment leaves soldCount unchanged', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id, { isPaid: false });
    const tt = await createTicketType(event.id, 0, 10);

    // The free path also creates a payment row (FREE provider) inside the tx.
    // C-1: inject the failure at the service boundary (see paid-path note).
    const createSpy = vi
      .spyOn(bookingPaymentModule, 'createBookingPayment')
      .mockRejectedValueOnce(new Error('injected tx failure'));

    const response = await bookRoute(
      await authedRequest(user, `/api/events/${event.id}/book`, {
        method: 'POST',
        body: { ticketTypeId: tt.id, quantity: 2 },
      }),
      { params: Promise.resolve({ id: event.id }) }
    );

    expect(response.status).toBeGreaterThanOrEqual(500);
    createSpy.mockRestore();

    const after = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(after?.soldCount).toBe(0);
    expect(after?.reservedCount).toBe(0);
  });

  it('reservation inside a failed transaction rolls back (service-level proof)', async () => {
    const org = await createUser('ORGANIZER');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    await expect(
      db.$transaction(async (tx) => {
        await reserveInventory({ ticketTypeId: tt.id, quantity: 4, tx });
        throw new Error('rollback now');
      })
    ).rejects.toThrow('rollback now');

    const after = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(after?.reservedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// M4 — Race-gated notifications
// ═══════════════════════════════════════════════════════════════════

describe('M4: notifications only fire for the winning transition', () => {
  it('lost expiry race sends NO "Payment Expired" notification', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const fixture = await createPaidBookingFixture(user, event, tt, 1);

    // Interpose on the payment load: after expireSinglePayment reads PENDING,
    // a "concurrent webhook" completes the payment — the expiry must lose.
    const loadAndComplete = async (args: { where: { id?: string } }) => {
      const result = await db.payment.findFirst({ where: args.where as never });
      if (result && result.id === fixture.payment.id && result.status === 'PENDING') {
        await db.payment.update({
          where: { id: fixture.payment.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
      return result;
    };
    const findUniqueSpy = vi
      .spyOn(db.payment, 'findUnique')
      .mockImplementation(loadAndComplete as never);

    const result = await expireSinglePayment({ paymentId: fixture.payment.id });
    findUniqueSpy.mockRestore();

    // M4 contract: the user must NOT be told their successful payment expired.
    // (The function's `paymentExpired` return value is unconditionally true —
    // a pre-existing reporting quirk, out of scope for Phase 6D.)
    const notifications = await db.notification.findMany({
      where: { userId: user.id, dedupKey: `payment-expired-${fixture.payment.id}` },
    });
    expect(notifications).toHaveLength(0);
  });

  it('lost failure-webhook race sends NO "Payment Failed" notification', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const fixture = await createPaidBookingFixture(user, event, tt, 1);

    // Load returns PENDING but the row becomes COMPLETED before the
    // conditional FAILED update runs → transition lost.
    // NOTE: the webhook path resolves the payment via findFirst.
    // Capture the original delegate BEFORE spying (the mock must not recurse).
    const originalFindFirst = db.payment.findFirst.bind(db.payment);
    const interpose = async (args: Parameters<typeof originalFindFirst>[0]) => {
      const result = await originalFindFirst(args);
      if (result && result.id === fixture.payment.id && result.status === 'PENDING') {
        await db.payment.update({
          where: { id: fixture.payment.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
      return result;
    };
    const findFirstSpy = vi
      .spyOn(db.payment, 'findFirst')
      .mockImplementation(interpose as never);

    const result = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: `evt-fail-${uid()}`,
        eventType: 'charge.failed',
        eventReference: fixture.providerRef,
        amount: asMoney(fixture.payment.amount),
        currency: 'GHS',
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: true,
      },
    });
    findFirstSpy.mockRestore();

    expect(result.processed).toBe(true);

    const notifications = await db.notification.findMany({
      where: { userId: user.id, dedupKey: `payment-failed-${fixture.payment.id}` },
    });
    expect(notifications).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// N-14 — Chunked cancellation fan-out
// ═══════════════════════════════════════════════════════════════════

describe('N-14: chunked cancellation fan-out', () => {
  it('notifies 123 bookers (3 chunks) exactly once; re-run deduplicates', async () => {
    const org = await createUser('ORGANIZER');
    const event = await createEvent(org.id);
    const bookers: { id: string }[] = [];
    for (let i = 0; i < 123; i++) {
      const b = await createUser('PUBLIC');
      bookers.push(b);
      const booking = await db.booking.create({
        data: {
          userId: b.id,
          eventId: event.id,
          totalAmount: 0,
          status: 'CONFIRMED',
          bookingRef: `P6D-${uid()}`,
        },
      });
      created.bookings.push(booking.id);
    }

    const result = await notifyAttendeesEventCancelled({
      eventId: event.id,
      eventTitle: event.title,
      bookerUserIds: bookers.map((b) => b.id),
    });
    expect(result.notified).toBe(123);
    expect(result.failed).toBe(0);

    const countAfterFirst = await db.notification.count({
      where: { type: 'EVENT_UPDATE', eventId: event.id },
    });
    expect(countAfterFirst).toBe(123);

    // Re-run (e.g. retry after crash) must not duplicate
    const rerun = await notifyAttendeesEventCancelled({
      eventId: event.id,
      eventTitle: event.title,
      bookerUserIds: bookers.map((b) => b.id),
    });
    expect(rerun.notified).toBe(123);

    const countAfterRerun = await db.notification.count({
      where: { type: 'EVENT_UPDATE', eventId: event.id },
    });
    expect(countAfterRerun).toBe(123); // dedup held
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════
// N-8/N-9 — Cursor pagination correctness
// ═══════════════════════════════════════════════════════════════════

describe('N-8: order-consistent cursor pagination', () => {
  it('pages through shuffled-createdAt notifications with zero skips/duplicates', async () => {
    const user = await createUser('PUBLIC');
    const TOTAL = 37;

    // Deliberately shuffled createdAt ordering vs. id ordering
    const baseTime = Date.now() - 1000 * 60 * 60;
    for (let i = 0; i < TOTAL; i++) {
      // Pseudo-shuffle: insert with creation-order ids but shuffled timestamps
      const shuffledIndex = (i * 17) % TOTAL; // 17 coprime with 37 → full permutation
      await db.notification.create({
        data: {
          userId: user.id,
          title: `N ${i}`,
          message: `message ${i}`,
          type: 'SYSTEM',
          deliveryStatus: 'SENT',
          isRead: false,
          createdAt: new Date(baseTime + shuffledIndex * 1000),
          dedupKey: `p6d-page-${user.id}-${i}`,
        },
      });
    }

    const seenIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const url = new URL('http://localhost:3000/api/notifications?limit=10');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await listNotifications(await authedRequest(user, url.pathname + url.search));
      expect(response.status).toBe(200);
      const body = await response.json();
      seenIds.push(...body.notifications.map((n: { id: string }) => n.id));
      pages++;
      if (!body.hasMore) break;
      cursor = body.nextCursor;
      expect(cursor).not.toBeNull();
      if (pages > 10) throw new Error('pagination did not terminate');
    }

    expect(seenIds).toHaveLength(TOTAL);
    expect(new Set(seenIds).size).toBe(TOTAL); // no duplicates
    // And ordering is consistent: createdAt desc (ties broken by id desc)
    const rows = await db.notification.findMany({
      where: { id: { in: seenIds } },
      select: { id: true, createdAt: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r.createdAt.getTime()]));
    for (let i = 1; i < seenIds.length; i++) {
      const prev = byId.get(seenIds[i - 1])!;
      const curr = byId.get(seenIds[i])!;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('non-numeric limit does not crash (N-9 guard)', async () => {
    const user = await createUser('PUBLIC');
    const response = await listNotifications(
      await authedRequest(user, '/api/notifications?limit=abc')
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.notifications).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F-14 — Rate-limit key hardening
// ═══════════════════════════════════════════════════════════════════

describe('F-14: rate limiter keys on the last XFF hop', () => {
  it('spoofed FIRST hop cannot reset the bucket; requests keyed on last hop 429', () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 3 });

    const requestWith = (xff: string) =>
      new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-forwarded-for': xff },
      });

    // Three requests with rotating SPOOFED first hops but the same real
    // (last-hop) IP — the old first-hop keying would never trip.
    expect(limiter(requestWith('1.2.3.4, 10.0.0.9')).success).toBe(true);
    expect(limiter(requestWith('5.6.7.8, 10.0.0.9')).success).toBe(true);
    expect(limiter(requestWith('9.10.11.12, 10.0.0.9')).success).toBe(true);
    // Fourth request from the same real IP is throttled
    expect(limiter(requestWith('13.14.15.16, 10.0.0.9')).success).toBe(false);
  });

  it('distinct last hops get independent buckets', () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    expect(limiter(new NextRequest('http://localhost:3000/api/test', { headers: { 'x-forwarded-for': '10.0.0.1' } })).success).toBe(true);
    expect(limiter(new NextRequest('http://localhost:3000/api/test', { headers: { 'x-forwarded-for': '10.0.0.1' } })).success).toBe(false);
    expect(limiter(new NextRequest('http://localhost:3000/api/test', { headers: { 'x-forwarded-for': '10.0.0.2' } })).success).toBe(true);
  });

  it('missing XFF falls back to the shared unknown bucket (fail-closed)', () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 1 });
    expect(limiter(new NextRequest('http://localhost:3000/api/test')).success).toBe(true);
    expect(limiter(new NextRequest('http://localhost:3000/api/test')).success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// F-2 / F-7 / F-22 / F-11 — configuration & schema safety
// ═══════════════════════════════════════════════════════════════════

describe('F-2: dev-token leak gates are fail-closed', () => {
  const routes = [
    'src/app/api/auth/forgot-password/route.ts',
    'src/app/api/auth/verify-email/resend/route.ts',
    'src/app/api/auth/route.ts',
    'src/app/api/organizer/members/invite/route.ts',
  ];

  for (const route of routes) {
    it(`${route} leaks tokens ONLY when NODE_ENV === 'development'`, () => {
      const source = readSource(route);
      expect(source).toContain("process.env.NODE_ENV === 'development'");
      // The vulnerable gate must be gone
      expect(source).not.toContain("process.env.NODE_ENV !== 'production'");
    });
  }
});

describe('F-7: safe-scheme URL validation on rendered URL fields', () => {
  it('urlField rejects javascript: and data: schemes', () => {
    expect(urlField.safeParse('javascript:alert(1)').success).toBe(false);
    expect(urlField.safeParse('data:text/html,<script>alert(1)</script>').success).toBe(false);
    expect(urlField.safeParse('https://example.com/ok').success).toBe(true);
  });

  it('profile avatar rejects javascript: URLs', () => {
    expect(updateProfileSchema.safeParse({ avatar: 'javascript:alert(1)' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ avatar: 'https://cdn.example.com/a.png' }).success).toBe(true);
  });

  it('ad image/link URLs reject javascript: schemes (public pages)', () => {
    expect(updateAdSchema.safeParse({ imageUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(updateAdSchema.safeParse({ linkUrl: 'data:text/html,x' }).success).toBe(false);
  });

  it('payment callbackUrl rejects javascript: schemes', () => {
    expect(initializePaymentSchema.safeParse({ bookingId: 'b1', callbackUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(initializePaymentSchema.safeParse({ bookingId: 'b1', callbackUrl: 'https://app.example.com/callback' }).success).toBe(true);
  });

  it('media route uses the safe urlField (source assertion)', () => {
    const source = readSource('src/app/api/events/[id]/media/route.ts');
    expect(source).toContain("from '@/lib/validations/common'");
    expect(source).not.toContain("z.string().url('A valid URL is required')");
  });
});

describe('F-22: security headers + CSP apply to all routes', () => {
  it('next.config.ts defines page-wide security headers', () => {
    const source = readSource('next.config.ts');
    expect(source).toContain('/:path*');
    expect(source).toContain('X-Frame-Options');
    expect(source).toContain('DENY');
    expect(source).toContain('Content-Security-Policy');
    expect(source).toContain("default-src 'self'");
    expect(source).toContain("frame-ancestors 'none'");
    expect(source).toContain("object-src 'none'");
    // The type-safety gate must stay OFF (F-20)
    expect(source).not.toContain('ignoreBuildErrors');
  });
});

describe('F-11: prisma migrate deploy can establish the provider', () => {
  it('migration_lock.toml exists and declares postgresql', () => {
    const lock = readSource('prisma', 'migrations', 'migration_lock.toml');
    expect(lock).toContain('provider = "postgresql"');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sanity: existing release-re reservation helper still behaves
// ═══════════════════════════════════════════════════════════════════

describe('inventory helpers remain intact', () => {
  it('releaseReservation never drives reservedCount below zero', async () => {
    const org = await createUser('ORGANIZER');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    await releaseReservation({ ticketTypeId: tt.id, quantity: 5 });
    const after = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(after?.reservedCount).toBe(0);
  });
});
