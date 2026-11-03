/**
 * Phase 6D verification round: independent audit sweep fixes
 * @vitest-environment node
 *
 * These tests cover the six defects found by the Phase 6D verification sweep
 * (post-7426624), each personally verified against the code before fixing:
 *
 *   C-1 (CRITICAL, pre-existing at 5d1ccca) — createBookingPayment ran on the
 *       GLOBAL db connection inside the booking route's interactive
 *       transaction. On PostgreSQL the Payment INSERT blocks on the
 *       uncommitted Booking foreign key until the transaction times out —
 *       every paid AND free booking fails. Fix: optional `tx` param threaded
 *       from both book-route paths. Proven by:
 *       - success-path route tests (paid + free) on SQLite
 *       - a transaction-participation rollback proof (pre-fix, the payment
 *         row would survive the rolled-back transaction)
 *       - a PG-gated success-path test (skipped on SQLite)
 *
 *   H-2 — payment initialize re-issued a Paystack authorization URL for a
 *       TERMINAL payment (FAILED/CANCELLED/EXPIRED/REFUNDED) returned by the
 *       idempotency fallback; success for such a payment can never be
 *       confirmed (webhook/verify refuse terminal states) — the user could be
 *       charged with no path to tickets. Fix: 400 PAYMENT_NOT_RETRYABLE.
 *
 *   H-3 — a COMPLETED full refund closed the ledger but left tickets VALID
 *       and the booking CONFIRMED (free entry after refund). Fix:
 *       processRefundCompletion now cancels non-USED tickets, restores
 *       soldCount for VALID ones, and transitions the booking to REFUNDED.
 *
 *   H-4 — booking-cancel classified inventory operations from a
 *       PRE-TRANSACTION ticket snapshot; a confirm committing between the
 *       snapshot and the transaction caused restoreSoldCount to be skipped
 *       forever (permanent inventory leak). Fix: classify from in-transaction
 *       state, tested by simulating the interleaving.
 *
 *   H-5 — verifyAccessToken never bound the session's userId to the token's
 *       userId claim (silent account takeover if the signing secret leaks),
 *       and JWT_SECRET strength was unenforced in production. Fix: session
 *       owner binding + >=32-char / no-placeholder production gate.
 *
 *   H-6 — non-public roles could list and read ANY organizer's events at any
 *       status with full private fields (cross-tenant exposure). Fix:
 *       own-org scoping on the list route; public treatment (404 for
 *       non-visible, filtered fields otherwise) for non-owners on detail.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// ─── Services under test ───
import { reserveInventory } from '@/lib/services/inventory';
import {
  createBookingPayment,
  generateIdempotencyKey,
} from '@/lib/services/booking-payment';
import { createPendingTickets, activateTickets } from '@/lib/services/ticket-service';
import { processRefundCompletion } from '@/lib/services/refund-service';
import {
  generateToken,
  verifyAccessToken,
  createSessionAndTokens,
} from '@/lib/auth';
import { env, _resetEnv } from '@/lib/env';
import { providerRegistry } from '@/lib/services/payment-provider';
import type { InitializePaymentOutcome } from '@/lib/services/payment-provider';

// ─── Route handlers under test ───
import { POST as bookRoute } from '@/app/api/events/[id]/book/route';
import { POST as initializePaymentRoute } from '@/app/api/payments/initialize/route';
import { PATCH as cancelBookingRoute } from '@/app/api/bookings/[id]/cancel/route';
import { GET as listEventsRoute } from '@/app/api/events/route';
import { GET as getEventRoute } from '@/app/api/events/[id]/route';

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
  organizerProfiles: [] as string[],
};

async function createUser(role: string = 'PUBLIC') {
  const user = await db.user.create({
    data: {
      email: `p6dv-${uid()}@test.com`,
      password: await bcrypt.hash('testpass123', 12),
      name: `Test ${role} ${uid()}`,
      role,
    },
  });
  created.users.push(user.id);
  return user;
}

async function createOrganizerProfile(user: { id: string }) {
  const profile = await db.organizerProfile.create({
    data: {
      userId: user.id,
      organizationName: `Org ${uid()}`,
      slug: `org-${uid()}`,
    },
  });
  created.organizerProfiles.push(profile.id);
  return profile;
}

async function createEvent(
  organizerId: string,
  overrides?: { price?: number; isPaid?: boolean; status?: string; contactEmail?: string }
) {
  const event = await db.event.create({
    data: {
      title: `Test Event ${uid()}`,
      slug: `evt-${uid()}`,
      description: 'Phase 6D verification test event',
      startDate: new Date('2026-03-01'),
      organizerId,
      status: overrides?.status ?? 'PUBLISHED',
      isPaid: overrides?.isPaid ?? true,
      contactEmail: overrides?.contactEmail ?? null,
      currency: 'GHS',
    },
  });
  created.events.push(event.id);
  return event;
}

async function createTicketType(eventId: string, price: number, quantity: number) {
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

/** PENDING booking + reserved inventory + PENDING PAYSTACK payment + PENDING tickets */
async function createPaidBookingFixture(
  user: { id: string },
  event: { id: string },
  ticketType: { id: string },
  quantity = 2
) {
  const price = 5000;
  const totalAmount = price * quantity;

  const booking = await db.booking.create({
    data: {
      userId: user.id,
      eventId: event.id,
      totalAmount,
      currency: 'GHS',
      status: 'PENDING',
      bookingRef: `BK-${uid()}`,
    },
  });
  created.bookings.push(booking.id);

  await reserveInventory({ ticketTypeId: ticketType.id, quantity });

  const payment = await db.payment.create({
    data: {
      bookingId: booking.id,
      userId: user.id,
      amount: totalAmount,
      currency: 'GHS',
      provider: 'PAYSTACK',
      status: 'PENDING',
      idempotencyKey: generateIdempotencyKey(),
      providerRef: `ps_ref_${uid()}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  created.payments.push(payment.id);

  const ticketResult = await createPendingTickets({
    bookingId: booking.id,
    ticketTypeId: ticketType.id,
    quantity,
    bookingRef: booking.bookingRef,
  });
  created.tickets.push(...ticketResult.ticketIds);

  return { booking, payment, ticketIds: ticketResult.ticketIds };
}

/** CONFIRMED booking + COMPLETED payment + VALID tickets + soldCount=qty */
async function createConfirmedBookingFixture(
  user: { id: string },
  event: { id: string },
  ticketType: { id: string },
  quantity = 2
) {
  const price = 5000;
  const totalAmount = price * quantity;

  const booking = await db.booking.create({
    data: {
      userId: user.id,
      eventId: event.id,
      totalAmount,
      currency: 'GHS',
      status: 'CONFIRMED',
      bookingRef: `BK-${uid()}`,
      confirmedAt: new Date(),
    },
  });
  created.bookings.push(booking.id);

  await db.$executeRaw`
    UPDATE "TicketType" SET "soldCount" = "soldCount" + ${quantity} WHERE "id" = ${ticketType.id}
  `;

  const payment = await db.payment.create({
    data: {
      bookingId: booking.id,
      userId: user.id,
      amount: totalAmount,
      currency: 'GHS',
      provider: 'PAYSTACK',
      status: 'COMPLETED',
      idempotencyKey: generateIdempotencyKey(),
      providerRef: `ps_ref_${uid()}`,
      completedAt: new Date(),
    },
  });
  created.payments.push(payment.id);

  const ticketResult = await createPendingTickets({
    bookingId: booking.id,
    ticketTypeId: ticketType.id,
    quantity,
    bookingRef: booking.bookingRef,
  });
  await activateTickets({ bookingId: booking.id });
  created.tickets.push(...ticketResult.ticketIds);

  return { booking, payment, ticketIds: ticketResult.ticketIds };
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

// ═══════════════════════════════════════════════════════════════════
// SETUP / TEARDOWN
// ═══════════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
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
  for (const id of created.organizerProfiles) {
    await db.organizerProfile.delete({ where: { id } }).catch(() => {});
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
  created.organizerProfiles = [];
  created.users = [];
});

// ═══════════════════════════════════════════════════════════════════
// C-1 — Booking payment participates in the booking transaction
// ═══════════════════════════════════════════════════════════════════

describe('C-1: booking payment runs inside the booking transaction', () => {
  it('paid booking success path completes atomically through the route', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    const response = await bookRoute(
      await authedRequest(user, `/api/events/${event.id}/book`, {
        method: 'POST',
        body: { ticketTypeId: tt.id, quantity: 2 },
      }),
      { params: Promise.resolve({ id: event.id }) }
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    const bookingId = body.booking.id as string;
    expect(body.booking.status).toBe('PENDING');
    expect(body.payment.status).toBe('PENDING');
    expect(body.payment.provider).toBe('PAYSTACK');

    // All rows committed with correct state
    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    expect(booking?.status).toBe('PENDING');

    const payment = await db.payment.findUnique({ where: { bookingId } });
    expect(payment?.status).toBe('PENDING');
    expect(payment?.provider).toBe('PAYSTACK');
    expect(payment?.idempotencyKey).toBeTruthy();

    const tickets = await db.ticket.findMany({ where: { bookingId } });
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.status === 'PENDING')).toBe(true);

    const after = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(after?.reservedCount).toBe(2);
    expect(after?.soldCount).toBe(0);
  });

  it('free booking success path completes atomically through the route', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id, { isPaid: false });
    const tt = await createTicketType(event.id, 0, 10);

    const response = await bookRoute(
      await authedRequest(user, `/api/events/${event.id}/book`, {
        method: 'POST',
        body: { ticketTypeId: tt.id, quantity: 2 },
      }),
      { params: Promise.resolve({ id: event.id }) }
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    const bookingId = body.booking.id as string;
    expect(body.booking.status).toBe('CONFIRMED');

    const payment = await db.payment.findUnique({ where: { bookingId } });
    expect(payment?.status).toBe('COMPLETED');
    expect(payment?.provider).toBe('FREE');

    const tickets = await db.ticket.findMany({ where: { bookingId } });
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.status === 'VALID')).toBe(true);

    const after = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(after?.soldCount).toBe(2);
    expect(after?.reservedCount).toBe(0);
  });

  it('service participates in the caller transaction (rollback proof)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const booking = await db.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 5000,
        currency: 'GHS',
        status: 'PENDING',
        bookingRef: `BK-${uid()}`,
      },
    });
    created.bookings.push(booking.id);

    let paymentIdInsideTx = '';
    await expect(
      db.$transaction(async (tx) => {
        const result = await createBookingPayment({
          bookingId: booking.id,
          userId: user.id,
          amount: 5000,
          currency: 'GHS',
          tx,
        });
        paymentIdInsideTx = result.paymentId;
        // Force the surrounding transaction to fail AFTER the payment INSERT
        throw new Error('rollback after payment creation');
      })
    ).rejects.toThrow('rollback after payment creation');

    // C-1 proof: the payment was created ON the transaction connection —
    // rolling back the transaction rolls back the payment. Pre-fix, the
    // payment was committed on a separate connection and survived here.
    const survived = await db.payment.findUnique({ where: { id: paymentIdInsideTx } });
    expect(survived).toBeNull();
  });
});

const IS_POSTGRES =
  (process.env.DATABASE_URL ?? '').startsWith('postgresql://') ||
  (process.env.DATABASE_URL ?? '').startsWith('postgres://');

describe.skipIf(!IS_POSTGRES)(
  'C-1 PG regression: booking route under real PostgreSQL (FK-wait)',
  () => {
    it('paid booking success path does not deadlock on the Booking foreign key', async () => {
      const org = await createUser('ORGANIZER');
      const user = await createUser('PUBLIC');
      const event = await createEvent(org.id);
      const tt = await createTicketType(event.id, 5000, 10);

      // Pre-fix this hung ~5s on the FK check and returned 500 on PostgreSQL.
      const response = await bookRoute(
        await authedRequest(user, `/api/events/${event.id}/book`, {
          method: 'POST',
          body: { ticketTypeId: tt.id, quantity: 2 },
        }),
        { params: Promise.resolve({ id: event.id }) }
      );

      expect(response.status).toBe(201);
      const body = await response.json();
      const after = await db.ticketType.findUnique({ where: { id: tt.id } });
      expect(after?.reservedCount).toBe(2);
      expect(body.booking.status).toBe('PENDING');
    });
  }
);

// ═══════════════════════════════════════════════════════════════════
// H-2 — Terminal payments are not re-initializable
// ═══════════════════════════════════════════════════════════════════

describe('H-2: payment initialize refuses terminal-state payments', () => {
  it('returns PAYMENT_NOT_RETRYABLE when the existing payment is FAILED', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    const { booking, payment } = await createPaidBookingFixture(user, event, tt);

    // The payment transitioned to terminal FAILED (e.g. by verify or expiry)
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED' },
    });

    const response = await initializePaymentRoute(
      await authedRequest(user, '/api/payments/initialize', {
        method: 'POST',
        body: { bookingId: booking.id },
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('PAYMENT_NOT_RETRYABLE');
  });

  it('still initializes a genuinely PENDING payment (no false rejection)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    const booking = await db.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 5000,
        currency: 'GHS',
        status: 'PENDING',
        bookingRef: `BK-${uid()}`,
      },
    });
    created.bookings.push(booking.id);
    await reserveInventory({ ticketTypeId: tt.id, quantity: 1 });

    // Mock the Paystack provider — no network in tests
    const fakeInitialize = vi.fn().mockResolvedValue({
      success: true,
      providerReference: `ps_ref_${uid()}`,
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'ac_test',
    } satisfies InitializePaymentOutcome);
    const requireSpy = vi
      .spyOn(providerRegistry, 'require')
      .mockReturnValue({ initializePayment: fakeInitialize } as never);

    const response = await initializePaymentRoute(
      await authedRequest(user, '/api/payments/initialize', {
        method: 'POST',
        body: { bookingId: booking.id },
      })
    );

    requireSpy.mockRestore();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.error).toBeUndefined();
    expect(body.payment.authorizationUrl).toBe('https://checkout.paystack.com/abc');
  });
});

// ═══════════════════════════════════════════════════════════════════
// H-3 — Full refund completion invalidates tickets and booking
// ═══════════════════════════════════════════════════════════════════

describe('H-3: full refund completion closes the ticket lifecycle', () => {
  it('cancels tickets, restores soldCount, and refunds the booking', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    const { booking, payment } = await createConfirmedBookingFixture(user, event, tt, 2);

    const refund = await db.refund.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount, // FULL refund
        status: 'PROCESSING',
        requestedBy: user.id,
      },
    });
    created.refunds.push(refund.id);

    const result = await processRefundCompletion({
      refundId: refund.id,
      providerRef: `rf_${uid()}`,
    });
    expect(result.status).toBe('COMPLETED');

    // Ledger closed
    const afterRefund = await db.refund.findUnique({ where: { id: refund.id } });
    expect(afterRefund?.status).toBe('COMPLETED');

    const afterPayment = await db.payment.findUnique({ where: { id: payment.id } });
    expect(afterPayment?.status).toBe('REFUNDED');
    expect(afterPayment?.refundedAmount).toBe(payment.amount);

    // H-3: tickets invalidated, booking refunded, inventory restored
    const tickets = await db.ticket.findMany({ where: { bookingId: booking.id } });
    expect(tickets.length).toBe(2);
    expect(tickets.every((t) => t.status === 'CANCELLED')).toBe(true);

    const afterBooking = await db.booking.findUnique({ where: { id: booking.id } });
    expect(afterBooking?.status).toBe('REFUNDED');

    const afterTT = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(afterTT?.soldCount).toBe(0);
  });

  it('partial refund completion leaves booking and tickets intact', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    const { booking, payment } = await createConfirmedBookingFixture(user, event, tt, 2);

    const refund = await db.refund.create({
      data: {
        paymentId: payment.id,
        amount: 5000, // PARTIAL refund (half)
        status: 'PROCESSING',
        requestedBy: user.id,
      },
    });
    created.refunds.push(refund.id);

    await processRefundCompletion({ refundId: refund.id });

    const afterPayment = await db.payment.findUnique({ where: { id: payment.id } });
    expect(afterPayment?.status).toBe('COMPLETED'); // not fully refunded
    expect(afterPayment?.refundedAmount).toBe(5000);

    const tickets = await db.ticket.findMany({ where: { bookingId: booking.id } });
    expect(tickets.every((t) => t.status === 'VALID')).toBe(true);

    const afterBooking = await db.booking.findUnique({ where: { id: booking.id } });
    expect(afterBooking?.status).toBe('CONFIRMED');

    const afterTT = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(afterTT?.soldCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// H-4 — Booking cancel classifies inventory ops from in-transaction state
// ═══════════════════════════════════════════════════════════════════

describe('H-4: booking cancel race-safe inventory classification', () => {
  it('cancel-vs-confirm race restores soldCount from fresh in-tx state', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    const { booking, payment } = await createPaidBookingFixture(user, event, tt, 2);
    // reservedCount=2, tickets PENDING, payment PENDING at this point

    // Simulate the interleaving: confirmBookingOnPaymentSuccess COMMITS
    // between the cancel route's pre-transaction read and its transaction.
    // The spy intercepts exactly ONE db.booking.findUnique (the route's
    // pre-read), performs the real confirm, and returns the STALE snapshot
    // the route would have observed microseconds earlier.
    const realFindUnique = db.booking.findUnique.bind(db.booking);
    const spy = vi
      .spyOn(db.booking, 'findUnique')
      .mockImplementationOnce((async (args) => {
        const stale = await realFindUnique(args);
        await db.$transaction(async (ctx) => {
          await ctx.booking.update({
            where: { id: booking.id },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
          });
          await ctx.ticket.updateMany({
            where: { bookingId: booking.id, status: 'PENDING' },
            data: { status: 'VALID' },
          });
          await ctx.payment.update({
            where: { id: payment.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
          // Inventory: reserved → sold (portable guarded updates)
          await ctx.ticketType.update({
            where: { id: tt.id },
            data: {
              reservedCount: { decrement: 2 },
              soldCount: { increment: 2 },
            },
          });
        });
        return stale; // status PENDING, tickets PENDING — now stale
      }) as unknown as typeof db.booking.findUnique);

    const response = await cancelBookingRoute(
      await authedRequest(user, `/api/bookings/${booking.id}/cancel`, {
        method: 'PATCH',
        body: { reason: 'race test' },
      }),
      { params: Promise.resolve({ id: booking.id }) }
    );

    expect(response.status).toBe(200);
    spy.mockRestore();

    const afterBooking = await db.booking.findUnique({ where: { id: booking.id } });
    expect(afterBooking?.status).toBe('CANCELLED');

    const tickets = await db.ticket.findMany({ where: { bookingId: booking.id } });
    expect(tickets.every((t) => t.status === 'CANCELLED')).toBe(true);

    // THE assertion: soldCount was restored (confirm had incremented it to 2).
    // Pre-fix, classification came from the stale PENDING snapshot —
    // releaseReservation no-oped and soldCount leaked at 2 forever.
    const afterTT = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(afterTT?.soldCount).toBe(0);
    expect(afterTT?.reservedCount).toBe(0);

    // COMPLETED payment is kept (refund is a separate action)
    const afterPayment = await db.payment.findUnique({ where: { id: payment.id } });
    expect(afterPayment?.status).toBe('COMPLETED');
  });

  it('normal CONFIRMED cancel still restores soldCount (no regression)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    const { booking, payment } = await createConfirmedBookingFixture(user, event, tt, 2);

    const response = await cancelBookingRoute(
      await authedRequest(user, `/api/bookings/${booking.id}/cancel`, { method: 'PATCH' }),
      { params: Promise.resolve({ id: booking.id }) }
    );

    expect(response.status).toBe(200);

    const afterTT = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(afterTT?.soldCount).toBe(0);
    expect(afterTT?.reservedCount).toBe(0);

    const afterBooking = await db.booking.findUnique({ where: { id: booking.id } });
    expect(afterBooking?.status).toBe('CANCELLED');

    const afterPayment = await db.payment.findUnique({ where: { id: payment.id } });
    expect(afterPayment?.status).toBe('COMPLETED');
  });

  it('normal PENDING cancel still releases the reservation (no regression)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);

    const { booking, payment } = await createPaidBookingFixture(user, event, tt, 2);

    const response = await cancelBookingRoute(
      await authedRequest(user, `/api/bookings/${booking.id}/cancel`, { method: 'PATCH' }),
      { params: Promise.resolve({ id: booking.id }) }
    );

    expect(response.status).toBe(200);

    const afterTT = await db.ticketType.findUnique({ where: { id: tt.id } });
    expect(afterTT?.reservedCount).toBe(0);
    expect(afterTT?.soldCount).toBe(0);

    const afterBooking = await db.booking.findUnique({ where: { id: booking.id } });
    expect(afterBooking?.status).toBe('CANCELLED');

    const afterPayment = await db.payment.findUnique({ where: { id: payment.id } });
    expect(afterPayment?.status).toBe('CANCELLED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// H-5 — Access-token session binding + JWT_SECRET strength gate
// ═══════════════════════════════════════════════════════════════════

describe('H-5: token/session binding and secret strength', () => {
  it('rejects a token whose sessionId belongs to a different user', async () => {
    const userA = await createUser('PUBLIC');
    const userB = await createUser('PUBLIC');

    const { accessToken } = await createSessionAndTokens({
      userId: userA.id,
      email: userA.email,
      role: userA.role,
    });

    const legitimate = await verifyAccessToken(accessToken);
    expect(legitimate).not.toBeNull();
    expect(legitimate?.userId).toBe(userA.id);
    const attackerSessionId = legitimate!.sessionId;

    // Forge: valid signature, but claims userB while presenting userA's
    // (live, unrevoked) session. Pre-fix this was accepted — full takeover.
    const forged = await generateToken({
      userId: userB.id,
      email: userB.email,
      role: userB.role,
      sessionId: attackerSessionId,
    });

    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it('accepts a token bound to its own live session (control)', async () => {
    const userA = await createUser('PUBLIC');
    const { accessToken } = await createSessionAndTokens({
      userId: userA.id,
      email: userA.email,
      role: userA.role,
    });

    const payload = await verifyAccessToken(accessToken);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe(userA.id);
  });

  it('validateEnv rejects a short JWT_SECRET in production', () => {
    const prev = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      DATABASE_URL: process.env.DATABASE_URL,
      PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
      PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
      PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET,
    };
    const setEnv = (key: string, value: string) => {
      // process.env.NODE_ENV is typed read-only by Next.js — same workaround
      // as seed-production-guard.test.ts
      (process.env as Record<string, string | undefined>)[key] = value;
    };
    try {
      setEnv('NODE_ENV', 'production');
      setEnv('JWT_SECRET', 'short');
      process.env.DATABASE_URL = prev.DATABASE_URL?.startsWith('postgres')
        ? prev.DATABASE_URL
        : 'postgresql://postgres:postgres@localhost:5432/prodcheck';
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_placeholder_for_env_check';
      process.env.PAYSTACK_PUBLIC_KEY = 'pk_test_placeholder_for_env_check';
      process.env.PAYSTACK_WEBHOOK_SECRET = 'webhook_placeholder_for_env_check';
      _resetEnv();

      expect(() => {
        // Property access triggers validation (lazy proxy)
        void env.JWT_SECRET;
      }).toThrow(/JWT_SECRET/);
    } finally {
      Object.assign(process.env, prev);
      _resetEnv();
    }
  });

  it('validateEnv rejects known placeholder secrets in production', () => {
    const prev = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      DATABASE_URL: process.env.DATABASE_URL,
      PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
      PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
      PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET,
    };
    const setEnv = (key: string, value: string) => {
      (process.env as Record<string, string | undefined>)[key] = value;
    };
    try {
      setEnv('NODE_ENV', 'production');
      setEnv('JWT_SECRET', 'change-me-to-a-strong-random-secret');
      process.env.DATABASE_URL = prev.DATABASE_URL?.startsWith('postgres')
        ? prev.DATABASE_URL
        : 'postgresql://postgres:postgres@localhost:5432/prodcheck';
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_placeholder_for_env_check';
      process.env.PAYSTACK_PUBLIC_KEY = 'pk_test_placeholder_for_env_check';
      process.env.PAYSTACK_WEBHOOK_SECRET = 'webhook_placeholder_for_env_check';
      _resetEnv();

      expect(() => {
        void env.JWT_SECRET;
      }).toThrow(/JWT_SECRET/);
    } finally {
      Object.assign(process.env, prev);
      _resetEnv();
    }
  });

  it('validateEnv accepts a strong 32+ char JWT_SECRET in production', () => {
    const prev = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      DATABASE_URL: process.env.DATABASE_URL,
      PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
      PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
      PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET,
    };
    const setEnv = (key: string, value: string) => {
      (process.env as Record<string, string | undefined>)[key] = value;
    };
    try {
      setEnv('NODE_ENV', 'production');
      setEnv('JWT_SECRET', 'x'.repeat(48));
      process.env.DATABASE_URL = prev.DATABASE_URL?.startsWith('postgres')
        ? prev.DATABASE_URL
        : 'postgresql://postgres:postgres@localhost:5432/prodcheck';
      process.env.PAYSTACK_SECRET_KEY = 'sk_test_placeholder_for_env_check';
      process.env.PAYSTACK_PUBLIC_KEY = 'pk_test_placeholder_for_env_check';
      process.env.PAYSTACK_WEBHOOK_SECRET = 'webhook_placeholder_for_env_check';
      _resetEnv();

      expect(env.JWT_SECRET).toBe('x'.repeat(48));
    } finally {
      Object.assign(process.env, prev);
      _resetEnv();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// H-6 — Cross-tenant event read scoping
// ═══════════════════════════════════════════════════════════════════

describe('H-6: cross-tenant event scoping for privileged roles', () => {
  it('organizer cannot list another org\u2019s non-public events', async () => {
    const orgA = await createUser('ORGANIZER');
    const orgB = await createUser('ORGANIZER');
    await createOrganizerProfile(orgA);
    await createOrganizerProfile(orgB);

    const draftA = await createEvent(orgA.id, { status: 'DRAFT' });
    const draftB = await createEvent(orgB.id, { status: 'DRAFT' });

    const response = await listEventsRoute(
      await authedRequest(orgB, '/api/events?status=DRAFT')
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const ids = (body.events as Array<{ id: string }>).map((e) => e.id);

    expect(ids).toContain(draftB.id); // own draft visible
    expect(ids).not.toContain(draftA.id); // cross-tenant draft hidden
  });

  it('unfiltered list shows own events of any status plus public events only', async () => {
    const orgA = await createUser('ORGANIZER');
    const orgB = await createUser('ORGANIZER');
    await createOrganizerProfile(orgA);
    await createOrganizerProfile(orgB);

    // Unique searchable tokens — the shared test DB holds thousands of
    // events, so page-1 assertions must be narrowed by search (which itself
    // is exercised by the M-7 fix).
    const tokenA = `ZZTokA${crypto.randomBytes(4).toString('hex')}`;
    const tokenB = `ZZTokB${crypto.randomBytes(4).toString('hex')}`;

    const draftA = await db.event.create({
      data: {
        title: `${tokenA} draft`,
        slug: `evt-${uid()}`,
        description: 'test',
        startDate: new Date('2026-03-01'),
        organizerId: orgA.id,
        status: 'DRAFT',
        isPaid: true,
        currency: 'GHS',
      },
    });
    created.events.push(draftA.id);
    const publishedA = await db.event.create({
      data: {
        title: `${tokenA} published`,
        slug: `evt-${uid()}`,
        description: 'test',
        startDate: new Date('2026-03-01'),
        organizerId: orgA.id,
        status: 'PUBLISHED',
        contactEmail: 'secret-a@test.com',
        isPaid: true,
        currency: 'GHS',
      },
    });
    created.events.push(publishedA.id);
    const draftB = await db.event.create({
      data: {
        title: `${tokenB} draft`,
        slug: `evt-${uid()}`,
        description: 'test',
        startDate: new Date('2026-03-01'),
        organizerId: orgB.id,
        status: 'DRAFT',
        contactEmail: 'own-b@test.com',
        isPaid: true,
        currency: 'GHS',
      },
    });
    created.events.push(draftB.id);

    // B searching for own token: own DRAFT must appear WITH private fields
    const ownResponse = await listEventsRoute(
      await authedRequest(orgB, `/api/events?search=${tokenB}`)
    );
    expect(ownResponse.status).toBe(200);
    const ownBody = await ownResponse.json();
    const ownEvents = ownBody.events as Array<{ id: string; contactEmail?: string | null }>;
    const ownDraft = ownEvents.find((e) => e.id === draftB.id);
    expect(ownDraft).toBeDefined();
    expect(ownDraft?.contactEmail).toBe('own-b@test.com');

    // B searching for A's token: only A's PUBLISHED event appears, WITHOUT
    // private fields; A's DRAFT must not appear at all
    const crossResponse = await listEventsRoute(
      await authedRequest(orgB, `/api/events?search=${tokenA}`)
    );
    expect(crossResponse.status).toBe(200);
    const crossBody = await crossResponse.json();
    const crossEvents = crossBody.events as Array<{ id: string; contactEmail?: string | null }>;
    const crossIds = crossEvents.map((e) => e.id);

    expect(crossIds).toContain(publishedA.id);
    expect(crossIds).not.toContain(draftA.id);
    const aPublishedForB = crossEvents.find((e) => e.id === publishedA.id)!;
    expect(aPublishedForB.contactEmail).toBeUndefined();
  });

  it('detail route: 404 for other-org draft, filtered for other-org published, full for own', async () => {
    const orgA = await createUser('ORGANIZER');
    const orgB = await createUser('ORGANIZER');
    const admin = await createUser('SUPER_ADMIN');
    await createOrganizerProfile(orgA);
    await createOrganizerProfile(orgB);

    const draftA = await createEvent(orgA.id, { status: 'DRAFT' });
    const publishedA = await createEvent(orgA.id, {
      status: 'PUBLISHED',
      contactEmail: 'secret-a@test.com',
    });

    // B cannot see A's DRAFT at all
    const draftResponse = await getEventRoute(
      await authedRequest(orgB, `/api/events/${draftA.id}`),
      { params: Promise.resolve({ id: draftA.id }) }
    );
    expect(draftResponse.status).toBe(404);

    // B sees A's PUBLISHED event but WITHOUT private fields
    const filteredResponse = await getEventRoute(
      await authedRequest(orgB, `/api/events/${publishedA.id}`),
      { params: Promise.resolve({ id: publishedA.id }) }
    );
    expect(filteredResponse.status).toBe(200);
    const filteredBody = await filteredResponse.json();
    expect((filteredBody.event as { contactEmail?: string }).contactEmail).toBeUndefined();

    // A sees own published event WITH private fields
    const ownResponse = await getEventRoute(
      await authedRequest(orgA, `/api/events/${publishedA.id}`),
      { params: Promise.resolve({ id: publishedA.id }) }
    );
    expect(ownResponse.status).toBe(200);
    const ownBody = await ownResponse.json();
    expect((ownBody.event as { contactEmail?: string }).contactEmail).toBe('secret-a@test.com');

    // SUPER_ADMIN sees full fields for any event, any status
    const adminResponse = await getEventRoute(
      await authedRequest(admin, `/api/events/${draftA.id}`),
      { params: Promise.resolve({ id: draftA.id }) }
    );
    expect(adminResponse.status).toBe(200);
    const adminBody = await adminResponse.json();
    expect((adminBody.event as { id: string }).id).toBe(draftA.id);
  });
});
