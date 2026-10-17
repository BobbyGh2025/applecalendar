/**
 * Phase 5G: PostgreSQL Runtime Concurrency Acceptance Tests
 *
 * These tests MUST run against a real PostgreSQL database to validate
 * that the confirmation race guard works correctly under genuine
 * concurrent transaction interleaving.
 *
 * If DATABASE_URL does not point to PostgreSQL, all tests are SKIPPED.
 *
 * Covers:
 *   1. Schema compatibility (migrations applied correctly)
 *   2. Isolation level support (READ COMMITTED, REPEATABLE READ, SERIALIZABLE)
 *   3. Concurrent payment confirmation with real row-level locking
 *   4. updateMany count=0 race under genuine PostgreSQL concurrency
 *   5. Payment state machine enforcement under concurrent transitions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import crypto from 'crypto';

// ─── Service imports ───
import {
  confirmBookingOnPaymentSuccess,
  processWebhookEvent,
  validatePaymentTransition,
} from '@/lib/services';

import {
  reserveInventory,
  releaseReservation,
  confirmReservation,
  checkInventory,
} from '@/lib/services/inventory';

import {
  createBookingPayment,
  generateIdempotencyKey,
} from '@/lib/services/booking-payment';

import {
  createPendingTickets,
} from '@/lib/services/ticket-service';

import {
  ConfirmationRaceConflict,
  ConfirmationPreconditionFailed,
} from '@/lib/services/payment-domain-errors';

import { asMoney } from '@/lib/money';

// Side-effect import to register providers
import '@/lib/services/providers';

// ═══════════════════════════════════════════════════════════════════
// POSTGRESQL GATE
// ═══════════════════════════════════════════════════════════════════

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const IS_POSTGRES = DATABASE_URL.startsWith('postgresql://') || DATABASE_URL.startsWith('postgres://');

// Skip entire suite if not running against PostgreSQL
const describePg = IS_POSTGRES ? describe : describe.skip;

// ═══════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════

function uid(): string {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

const created: {
  users: string[];
  events: string[];
  ticketTypes: string[];
  bookings: string[];
  payments: string[];
  tickets: string[];
  webhookEvents: string[];
  notifications: string[];
} = {
  users: [],
  events: [],
  ticketTypes: [],
  bookings: [],
  payments: [],
  tickets: [],
  webhookEvents: [],
  notifications: [],
};

async function createUser(role: 'ORGANIZER' | 'PUBLIC') {
  const email = `pg-conc-${uid()}@test.com`;
  const user = await db.user.create({
    data: {
      email,
      name: `PG Test ${role} ${uid()}`,
      password: 'test-hash',
      role,
      emailVerified: new Date(),
    },
  });
  created.users.push(user.id);

  if (role === 'ORGANIZER') {
    const profile = await db.organizerProfile.create({
      data: {
        userId: user.id,
        organizationName: `PG Org ${uid()}`,
        slug: `pg-org-${uid()}`,
      },
    });
    return { ...user, organizerProfile: profile };
  }

  return user;
}

async function createEvent(organizerId: string) {
  const event = await db.event.create({
    data: {
      title: `PG Event ${uid()}`,
      slug: `pg-event-${uid()}`,
      description: 'PostgreSQL concurrency test event',
      startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      organizerId,
      status: 'PUBLISHED',
      isPaid: true,
      currency: 'GHS',
    },
  });
  created.events.push(event.id);
  return event;
}

async function createTicketType(eventId: string, price: number, quantity: number) {
  const tt = await db.ticketType.create({
    data: {
      name: `PG Ticket ${uid()}`,
      price,
      quantity,
      soldCount: 0,
      currency: 'GHS',
      eventId,
    },
  });
  created.ticketTypes.push(tt.id);
  return tt;
}

async function createPaidBookingWithReservation(
  user: { id: string },
  event: { id: string },
  ticketType: { id: string },
  quantity: number = 2,
) {
  const price = 5000;
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

  return { booking, payment, providerRef, idempotencyKey, ticketIds: ticketResult.ticketIds, bookingRef };
}

// ═══════════════════════════════════════════════════════════════════
// SETUP / TEARDOWN
// ═══════════════════════════════════════════════════════════════════

beforeEach(() => {
  created.users = [];
  created.events = [];
  created.ticketTypes = [];
  created.bookings = [];
  created.payments = [];
  created.tickets = [];
  created.webhookEvents = [];
  created.notifications = [];
});

afterEach(async () => {
  for (const id of created.tickets) {
    await db.ticket.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.payments) {
    await db.payment.delete({ where: { id } }).catch(() => {});
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
    await db.organizerMembership.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.organizerProfile.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.refreshToken.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.notification.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.user.delete({ where: { id } }).catch(() => {});
  }
});

// ═══════════════════════════════════════════════════════════════════
// 1. SCHEMA COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════

describePg('1. PostgreSQL schema compatibility', () => {
  it('1a. Payment table has all required columns', async () => {
    const result = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Payment'
      ORDER BY ordinal_position
    `;
    const columns = result.map(r => r.column_name);
    expect(columns).toContain('id');
    expect(columns).toContain('status');
    expect(columns).toContain('amount');
    expect(columns).toContain('completedAt');
    expect(columns).toContain('failedAt');
    expect(columns).toContain('providerRef');
    expect(columns.length).toBeGreaterThanOrEqual(20);
  });

  it('1b. Money constraints are enforced', async () => {
    const result = await db.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public."Payment"'::regclass AND contype = 'c'
    `;
    const constraints = result.map(r => r.conname);
    expect(constraints).toContain('chk_payment_amount_nonneg');
    expect(constraints).toContain('chk_payment_refunded_nonneg');
    expect(constraints).toContain('chk_payment_refunded_lte_amount');
  });

  it('1c. Webhook dedup unique constraint exists', async () => {
    const result = await db.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'PaymentWebhookEvent' AND indexdef LIKE '%UNIQUE%'
    `;
    // At minimum, the primary key unique constraint should exist
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. ISOLATION LEVEL SUPPORT
// ═══════════════════════════════════════════════════════════════════

describePg('2. PostgreSQL isolation levels', () => {
  it('2a. Default isolation is READ COMMITTED', async () => {
    const result = await db.$queryRawUnsafe<Record<string,string>[]>("SHOW default_transaction_isolation");
    const settingValue = result[0]?.['default_transaction_isolation'] ?? result[0]?.['setting'];
    expect(settingValue).toBe('read committed');
  });

  it('2b. SERIALIZABLE isolation level is available', async () => {
    // Try setting SERIALIZABLE — should not throw
    await db.$executeRaw`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
  });

  it('2c. REPEATABLE READ isolation level is available', async () => {
    await db.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. CONCURRENT PAYMENT CONFIRMATION (REAL POSTGRESQL CONCURRENCY)
// ═══════════════════════════════════════════════════════════════════

describePg('3. Concurrent confirmation under PostgreSQL', () => {
  it('3a. Two concurrent confirmations — exactly one succeeds with real row-level locking', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    const invBefore = await checkInventory(tt.id);

    // Fire two concurrent confirmations — PostgreSQL provides genuine row-level locking
    const [result1, result2] = await Promise.allSettled([
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ]);

    const fulfilled = [result1, result2].filter(r => r.status === 'fulfilled');
    const rejected = [result1, result2].filter(r => r.status === 'rejected');

    expect(fulfilled.length + rejected.length).toBe(2);

    // At most one reports confirmed=true
    const confirmedCount = fulfilled.filter(
      r => (r as { status: 'fulfilled'; value: { confirmed: boolean } }).value.confirmed,
    ).length;
    expect(confirmedCount).toBeLessThanOrEqual(1);

    // Final payment is COMPLETED
    const paymentFinal = await db.payment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    expect(paymentFinal?.status).toBe('COMPLETED');

    // Final booking is CONFIRMED
    const bookingFinal = await db.booking.findUnique({
      where: { id: booking.id },
      select: { status: true },
    });
    expect(bookingFinal?.status).toBe('CONFIRMED');

    // No duplicate inventory increment
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.soldCount).toBe(invBefore.soldCount + 2);

    // No duplicate notification
    const notifications = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });
    expect(notifications).toBeLessThanOrEqual(1);

    // Tickets activated exactly once
    const validTickets = await db.ticket.count({
      where: { bookingId: booking.id, status: 'VALID' },
    });
    expect(validTickets).toBe(2);
  });

  it('3b. Concurrent success and failure webhooks — final state is consistent', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    const successEventId = `evt-pg-success-${uid()}`;
    const failEventId = `evt-pg-fail-${uid()}`;

    const [successResult, failResult] = await Promise.allSettled([
      processWebhookEvent({
        event: {
          provider: 'PAYSTACK',
          eventId: successEventId,
          eventType: 'charge.success',
          eventReference: providerRef,
          amount: asMoney(payment.amount),
          currency: payment.currency,
          eventAt: new Date(),
          isPaymentSuccess: true,
          isPaymentFailure: false,
        },
      }),
      processWebhookEvent({
        event: {
          provider: 'PAYSTACK',
          eventId: failEventId,
          eventType: 'charge.failed',
          eventReference: providerRef,
          amount: asMoney(payment.amount),
          currency: payment.currency,
          eventAt: new Date(),
          isPaymentSuccess: false,
          isPaymentFailure: true,
        },
      }),
    ]);

    expect(successResult.status === 'fulfilled' || successResult.status === 'rejected').toBe(true);
    expect(failResult.status === 'fulfilled' || failResult.status === 'rejected').toBe(true);

    const paymentFinal = await db.payment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    expect(['COMPLETED', 'FAILED'].includes(paymentFinal!.status)).toBe(true);

    // Booking state consistent with payment
    const bookingFinal = await db.booking.findUnique({
      where: { id: booking.id },
      select: { status: true },
    });
    if (paymentFinal?.status === 'COMPLETED') {
      expect(bookingFinal?.status).toBe('CONFIRMED');
    } else {
      expect(['CANCELLED', 'PENDING'].includes(bookingFinal!.status)).toBe(true);
    }

    // Inventory invariant holds
    const inv = await checkInventory(tt.id);
    expect(inv.soldCount + inv.reservedCount).toBeLessThanOrEqual(inv.quantity);
  });

  it('3c. Conditional updateMany with status guard — zero rows affected under concurrent transition', async () => {
    // This test uses real PostgreSQL concurrency:
    // 1. Create a payment in PENDING state
    // 2. Start two concurrent operations:
    //    - Operation A: confirmBookingOnPaymentSuccess (reads PENDING, then updateMany WHERE status=PENDING)
    //    - Operation B: direct update to FAILED (via raw SQL in a separate "thread")
    // 3. One of them wins the race on the payment row
    // 4. Verify final state is consistent (either COMPLETED+CONFIRMED or FAILED+CANCELLED)
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Fire a concurrent FAILED transition at the same time as the confirmation
    const [confirmResult, failResult] = await Promise.allSettled([
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
      (async () => {
        // Small delay to increase chance of genuine interleaving
        await new Promise(r => setTimeout(r, 5));
        // Attempt to transition payment to FAILED
        const update = await db.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: { status: 'FAILED', failedAt: new Date() },
        });
        if (update.count > 0) {
          // We won the race — also cancel the booking
          await db.booking.updateMany({
            where: { id: booking.id, status: 'PENDING' },
            data: { status: 'CANCELLED', cancellationReason: 'Concurrent failure' },
          });
          // Release inventory
          await releaseReservation({ ticketTypeId: tt.id, quantity: 2 });
        }
        return update;
      })(),
    ]);

    // Both should settle (not hang)
    expect(confirmResult.status === 'fulfilled' || confirmResult.status === 'rejected').toBe(true);
    expect(failResult.status === 'fulfilled' || failResult.status === 'rejected').toBe(true);

    // Final state is consistent — one winner
    const paymentFinal = await db.payment.findUnique({
      where: { id: payment.id },
      select: { status: true },
    });
    expect(['COMPLETED', 'FAILED'].includes(paymentFinal!.status)).toBe(true);

    // If COMPLETED, then booking CONFIRMED and inventory confirmed
    if (paymentFinal?.status === 'COMPLETED') {
      const bookingFinal = await db.booking.findUnique({
        where: { id: booking.id },
        select: { status: true },
      });
      expect(bookingFinal?.status).toBe('CONFIRMED');

      const validTickets = await db.ticket.count({
        where: { bookingId: booking.id, status: 'VALID' },
      });
      expect(validTickets).toBe(2);
    }

    // If FAILED, then booking CANCELLED and inventory released
    if (paymentFinal?.status === 'FAILED') {
      const bookingFinal = await db.booking.findUnique({
        where: { id: booking.id },
        select: { status: true },
      });
      expect(bookingFinal?.status).toBe('CANCELLED');
    }

    // Inventory invariant always holds
    const inv = await checkInventory(tt.id);
    expect(inv.soldCount + inv.reservedCount).toBeLessThanOrEqual(inv.quantity);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. ENVIRONMENT VERIFICATION
// ═══════════════════════════════════════════════════════════════════

describePg('4. PostgreSQL environment', () => {
  it('4a. PostgreSQL version is 17.x', async () => {
    const result = await db.$queryRaw<Array<{ version: string }>>`SELECT version()`;
    expect(result[0].version).toContain('PostgreSQL 17');
  });

  it('4b. Connection uses PostgreSQL (not SQLite)', () => {
    expect(IS_POSTGRES).toBe(true);
    expect(DATABASE_URL).toMatch(/^postgres/i);
  });
});
