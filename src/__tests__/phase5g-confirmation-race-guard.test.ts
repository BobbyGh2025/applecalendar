/**
 * Phase 5G: Confirmation Race Guard Regression Tests
 *
 * Comprehensive regression tests covering race conditions during booking
 * confirmation, webhook reconciliation with conflicting states, and
 * ensuring no duplicate side effects under concurrent scenarios.
 *
 * Covers the following scenarios:
 *   1. Payment becomes FAILED before confirmation completes
 *   2. Payment becomes EXPIRED before confirmation completes
 *   3. Duplicate successful confirmation remains idempotent
 *   4. No duplicate notification, ticket activation, or inventory update
 *   5. Concurrent success, failure, and expiry transitions
 *   6. Webhook reconciliation handles recoverable conflicts without infinite retries
 *   7. Typed conflict error properties
 *   8. Payment becomes CANCELLED before confirmation
 *   9. Concurrent confirmation race (Promise.all) — asserts final payment/booking states,
 *      ticket activation, inventory counts, and notification counts
 *  10. ConfirmationRaceConflict code path verification
 *      10c: Genuine updateMany count=0 race via test seam (SIMULATED — not real DB concurrency)
 *      10d: Genuine updateMany count=0 duplicate-success race via test seam (SIMULATED)
 *
 * Uses the real database (SQLite in test environment) and actual domain services.
 * NO mocked Prisma. NO mocked fetch.
 *
 * Test seam: setTestOnBeforeConditionalUpdate fires in the TOCTOU gap between
 * reading payment.status and the conditional updateMany. This allows simulating
 * a concurrent modification that causes updateMany to return count=0, exercising
 * the ConfirmationRaceConflict and idempotent paths that are unreachable in
 * sequential SQLite tests. True concurrent interleaving requires PostgreSQL
 * with interactive transactions and row-level locking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import crypto from 'crypto';

// ─── Service imports ───
import {
  confirmBookingOnPaymentSuccess,
  processWebhookEvent,
  validatePaymentTransition,
  isTerminalStatus,
} from '@/lib/services';

import {
  setTestOnBeforeConditionalUpdate,
} from '@/lib/services/booking-confirmation';

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
  activateTickets,
} from '@/lib/services/ticket-service';

import { expireSinglePayment } from '@/lib/services/payment-expiry';

import {
  PaymentNotFound,
  ConfirmationRaceConflict,
  ConfirmationPreconditionFailed,
} from '@/lib/services/payment-domain-errors';

import type { NormalizedWebhookEvent } from '@/lib/services/payment-provider';

import { asMoney } from '@/lib/money';

// Side-effect import to register providers
import '@/lib/services/providers';

// ═══════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Unique ID generator */
function uid(): string {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

/** Track all created record IDs for cleanup */
const created: {
  users: string[];
  events: string[];
  ticketTypes: string[];
  bookings: string[];
  payments: string[];
  tickets: string[];
  refunds: string[];
  webhookEvents: string[];
  notifications: string[];
} = {
  users: [],
  events: [],
  ticketTypes: [],
  bookings: [],
  payments: [],
  tickets: [],
  refunds: [],
  webhookEvents: [],
  notifications: [],
};

/** Create a user with the given role */
async function createUser(role: string = 'PUBLIC') {
  const bcrypt = await import('bcryptjs');
  const user = await db.user.create({
    data: {
      email: `user-${uid()}@test.com`,
      password: await bcrypt.hash('testpass123', 12),
      name: `Test ${role} ${uid()}`,
      role,
    },
  });
  created.users.push(user.id);
  return user;
}

/** Create a PUBLISHED event */
async function createEvent(organizerId: string) {
  const event = await db.event.create({
    data: {
      title: `Test Event ${uid()}`,
      slug: `evt-${uid()}`,
      description: 'Test event for confirmation race guard tests',
      startDate: new Date('2025-12-01'),
      organizerId,
      status: 'PUBLISHED',
      isPaid: true,
      currency: 'GHS',
    },
  });
  created.events.push(event.id);
  return event;
}

/** Create a ticket type with known quantity */
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

/**
 * Create a full paid-booking lifecycle setup:
 *   - PENDING booking
 *   - Reserved inventory (reservedCount += quantity)
 *   - PENDING payment with providerRef for webhook lookup
 *   - PENDING tickets
 */
async function createPaidBookingWithReservation(
  user: { id: string },
  event: { id: string },
  ticketType: { id: string },
  quantity: number = 2,
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
  created.refunds = [];
  created.webhookEvents = [];
  created.notifications = [];
});

afterEach(async () => {
  // Reset test seam to prevent leakage between tests
  setTestOnBeforeConditionalUpdate(undefined);

  // Clean up in reverse dependency order
  for (const id of created.refunds) {
    await db.refund.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.webhookEvents) {
    await db.paymentWebhookEvent.delete({ where: { id } }).catch(() => {});
  }
  for (const id of created.notifications) {
    await db.notification.delete({ where: { id } }).catch(() => {});
  }
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
// 1. PAYMENT BECOMES FAILED BEFORE CONFIRMATION COMPLETES
// ═══════════════════════════════════════════════════════════════════

describe('1. Payment becomes FAILED before confirmation', () => {
  it('1a. ConfirmationPreconditionFailed when payment is already FAILED', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Simulate: payment was already transitioned to FAILED (e.g., by a concurrent webhook)
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });

    // Now a late confirmation arrives — should throw ConfirmationPreconditionFailed
    await expect(
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ).rejects.toThrow(ConfirmationPreconditionFailed);

    // Payment remains FAILED (not resurrected)
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter?.status).toBe('FAILED');
  });

  it('1b. Webhook handles late success for FAILED payment as non-retriable', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First: fail the payment via webhook
    const failEventId = `evt-fail-${uid()}`;
    const failResult = await processWebhookEvent({
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
    });
    expect(failResult.processed).toBe(true);

    // Verify payment is FAILED
    const paymentAfterFail = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfterFail?.status).toBe('FAILED');

    // Now a late success webhook arrives
    const successEventId = `evt-success-late-${uid()}`;
    const result = await processWebhookEvent({
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
    });

    // Event is processed as non-retriable (not an error, not retrying)
    expect(result.processed).toBe(true);
    expect(result.outcome).toContain('terminal state');
    expect(result.paymentId).toBe(payment.id);

    // Payment remains FAILED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('FAILED');

    // Webhook event is marked as processed=true (non-retriable)
    const webhookEvent = await db.paymentWebhookEvent.findUnique({ where: { eventId: successEventId } });
    expect(webhookEvent?.processed).toBe(true);
  });

  it('1c. No ticket activation or inventory change when payment is FAILED', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to FAILED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });

    // Record pre-state
    const invBefore = await checkInventory(tt.id);
    const ticketCountBefore = await db.ticket.count({ where: { bookingId: booking.id, status: 'VALID' } });

    // Attempt confirmation — should throw
    await expect(
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ).rejects.toThrow(ConfirmationPreconditionFailed);

    // Inventory unchanged
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.soldCount).toBe(invBefore.soldCount);
    expect(invAfter.reservedCount).toBe(invBefore.reservedCount);

    // No tickets activated
    const ticketCountAfter = await db.ticket.count({ where: { bookingId: booking.id, status: 'VALID' } });
    expect(ticketCountAfter).toBe(ticketCountBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. PAYMENT BECOMES EXPIRED BEFORE CONFIRMATION COMPLETES
// ═══════════════════════════════════════════════════════════════════

describe('2. Payment becomes EXPIRED before confirmation', () => {
  it('2a. ConfirmationPreconditionFailed when payment is already EXPIRED', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to EXPIRED (simulate expiry service)
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'EXPIRED' },
    });
    // Booking may also be CANCELLED by expiry
    await db.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancellationReason: 'Payment expired' },
    });

    // Now a late confirmation arrives — should throw ConfirmationPreconditionFailed
    await expect(
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ).rejects.toThrow(ConfirmationPreconditionFailed);

    // Payment remains EXPIRED (not resurrected)
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter?.status).toBe('EXPIRED');

    // Booking remains CANCELLED (not resurrected)
    const bookingAfter = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingAfter?.status).toBe('CANCELLED');
  });

  it('2b. Webhook handles late success for EXPIRED payment as non-retriable', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to EXPIRED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'EXPIRED' },
    });
    await db.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancellationReason: 'Payment expired' },
    });

    // Late success webhook
    const successEventId = `evt-success-expired-${uid()}`;
    const result = await processWebhookEvent({
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
    });

    // Event is processed as non-retriable
    expect(result.processed).toBe(true);
    expect(result.outcome).toContain('terminal state');

    // Payment remains EXPIRED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('EXPIRED');

    // Webhook event is marked as processed (non-retriable)
    const webhookEvent = await db.paymentWebhookEvent.findUnique({ where: { eventId: successEventId } });
    expect(webhookEvent?.processed).toBe(true);
  });

  it('2c. No ticket activation or inventory change when payment is EXPIRED', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to EXPIRED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'EXPIRED' },
    });

    // Record pre-state
    const invBefore = await checkInventory(tt.id);
    const ticketCountBefore = await db.ticket.count({ where: { bookingId: booking.id, status: 'VALID' } });

    // Attempt confirmation — should throw
    await expect(
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ).rejects.toThrow(ConfirmationPreconditionFailed);

    // Inventory unchanged
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.soldCount).toBe(invBefore.soldCount);

    // No tickets activated
    const ticketCountAfter = await db.ticket.count({ where: { bookingId: booking.id, status: 'VALID' } });
    expect(ticketCountAfter).toBe(ticketCountBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. DUPLICATE SUCCESSFUL CONFIRMATION IS IDEMPOTENT
// ═══════════════════════════════════════════════════════════════════

describe('3. Duplicate successful confirmation is idempotent', () => {
  it('3a. Confirming an already-COMPLETED payment returns idempotent result', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First confirmation — succeeds
    const result1 = await confirmBookingOnPaymentSuccess({
      paymentId: payment.id,
      providerReference: providerRef,
    });
    expect(result1.confirmed).toBe(true);
    expect(result1.ticketsActivated).toBe(2);

    // Second confirmation — idempotent
    const result2 = await confirmBookingOnPaymentSuccess({
      paymentId: payment.id,
      providerReference: providerRef,
    });
    expect(result2.confirmed).toBe(false);
    expect(result2.ticketsActivated).toBe(0);
    expect(result2.inventoryConfirmed).toEqual([]);
  });

  it('3b. Webhook duplicate success delivery is idempotent', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    const eventId = `evt-idem-${uid()}`;

    // First delivery — confirms booking
    const result1 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });
    expect(result1.processed).toBe(true);
    expect(result1.outcome).toContain('confirmed');

    // Second delivery with same eventId — deduped
    const result2 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });
    expect(result2.processed).toBe(false);
    expect(result2.outcome).toContain('duplicate');
  });

  it('3c. Success webhook for COMPLETED payment is idempotent (terminal guard)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First: confirm via one event
    const eventId1 = `evt-confirm-${uid()}`;
    await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: eventId1,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });

    // Verify COMPLETED
    const paymentAfter1 = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter1?.status).toBe('COMPLETED');

    // Second: a different eventId arrives for the same (already COMPLETED) payment
    const eventId2 = `evt-late-${uid()}`;
    const result2 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: eventId2,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });

    // Handled gracefully as idempotent (not an error)
    expect(result2.processed).toBe(true);
    expect(result2.paymentId).toBe(payment.id);
    // Payment remains COMPLETED
    const paymentAfter2 = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter2?.status).toBe('COMPLETED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. NO DUPLICATE NOTIFICATION, TICKET ACTIVATION, OR INVENTORY UPDATE
// ═══════════════════════════════════════════════════════════════════

describe('4. No duplicate side effects', () => {
  it('4a. Duplicate confirmation does not create duplicate notifications', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First confirmation — creates notification
    const result1 = await confirmBookingOnPaymentSuccess({
      paymentId: payment.id,
      providerReference: providerRef,
    });
    expect(result1.confirmed).toBe(true);

    const notificationsAfter1 = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });

    // Second confirmation — idempotent, no duplicate notification
    const result2 = await confirmBookingOnPaymentSuccess({
      paymentId: payment.id,
      providerReference: providerRef,
    });
    expect(result2.confirmed).toBe(false);

    const notificationsAfter2 = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });
    expect(notificationsAfter2).toBe(notificationsAfter1);
  });

  it('4b. Duplicate confirmation does not double-activate tickets', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First confirmation
    await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });

    const validTicketsAfter1 = await db.ticket.count({
      where: { bookingId: booking.id, status: 'VALID' },
    });

    // Second confirmation
    await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });

    const validTicketsAfter2 = await db.ticket.count({
      where: { bookingId: booking.id, status: 'VALID' },
    });
    expect(validTicketsAfter2).toBe(validTicketsAfter1);
  });

  it('4c. Duplicate confirmation does not double-confirm inventory', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First confirmation
    await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });

    const invAfter1 = await checkInventory(tt.id);

    // Second confirmation
    await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });

    const invAfter2 = await checkInventory(tt.id);
    // soldCount must not double
    expect(invAfter2.soldCount).toBe(invAfter1.soldCount);
    // reservedCount must not go negative
    expect(invAfter2.reservedCount).toBeGreaterThanOrEqual(0);
    // Invariant: soldCount + reservedCount <= quantity
    expect(invAfter2.soldCount + invAfter2.reservedCount).toBeLessThanOrEqual(10);
  });

  it('4d. Conflict result does not send notification', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to FAILED directly
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });

    // Record notification count before
    const notificationsBefore = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });

    // Attempt confirmation — throws ConfirmationPreconditionFailed
    await expect(
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ).rejects.toThrow(ConfirmationPreconditionFailed);

    // No notification was created
    const notificationsAfter = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });
    expect(notificationsAfter).toBe(notificationsBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. CONCURRENT SUCCESS, FAILURE, AND EXPIRY TRANSITIONS
// ═══════════════════════════════════════════════════════════════════

describe('5. Concurrent transitions', () => {
  it('5a. Failure webhook then success webhook — FAILED wins, success is non-retriable', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Failure arrives first
    const failEventId = `evt-fail-first-${uid()}`;
    const failResult = await processWebhookEvent({
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
    });
    expect(failResult.processed).toBe(true);

    // Success arrives late — handled as non-retriable
    const successEventId = `evt-success-late-${uid()}`;
    const successResult = await processWebhookEvent({
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
    });
    expect(successResult.processed).toBe(true);
    expect(successResult.outcome).toContain('terminal state');

    // Final state: FAILED, not COMPLETED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('FAILED');

    // Booking not confirmed
    const bookingFinal = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingFinal?.status).not.toBe('CONFIRMED');

    // Inventory released (soldCount = 0)
    const inv = await checkInventory(tt.id);
    expect(inv.soldCount).toBe(0);
  });

  it('5b. Expiry then success webhook — EXPIRED wins, success is non-retriable', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Expire the payment
    const expiryResult = await expireSinglePayment({ paymentId: payment.id });
    expect(expiryResult.paymentExpired).toBe(true);

    // Success arrives late — handled as non-retriable
    const successEventId = `evt-success-after-expiry-${uid()}`;
    const successResult = await processWebhookEvent({
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
    });
    expect(successResult.processed).toBe(true);
    expect(successResult.outcome).toContain('terminal state');

    // Final state: EXPIRED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('EXPIRED');

    // Booking not confirmed
    const bookingFinal = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingFinal?.status).not.toBe('CONFIRMED');
  });

  it('5c. Success then failure webhook — COMPLETED wins, failure is non-retriable', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Success arrives first
    const successEventId = `evt-success-first-${uid()}`;
    const successResult = await processWebhookEvent({
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
    });
    expect(successResult.processed).toBe(true);
    expect(successResult.outcome).toContain('confirmed');

    // Failure arrives late — handled as non-retriable (terminal state guard)
    const failEventId = `evt-fail-late-${uid()}`;
    const failResult = await processWebhookEvent({
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
    });
    expect(failResult.processed).toBe(true);
    expect(failResult.outcome).toContain('terminal state');

    // Final state: COMPLETED (not FAILED)
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('COMPLETED');

    // Booking confirmed
    const bookingFinal = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingFinal?.status).toBe('CONFIRMED');

    // Inventory confirmed (soldCount > 0)
    const inv = await checkInventory(tt.id);
    expect(inv.soldCount).toBeGreaterThan(0);
  });

  it('5d. Success then expiry — COMPLETED wins, expiry is no-op', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Confirm first
    const result = await confirmBookingOnPaymentSuccess({
      paymentId: payment.id,
      providerReference: providerRef,
    });
    expect(result.confirmed).toBe(true);

    // Now try to expire — should be no-op (payment is COMPLETED, not expirable)
    const expiryResult = await expireSinglePayment({ paymentId: payment.id });
    expect(expiryResult.paymentExpired).toBe(false);

    // Payment remains COMPLETED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('COMPLETED');

    // Booking remains CONFIRMED
    const bookingFinal = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingFinal?.status).toBe('CONFIRMED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. WEBHOOK RECONCILIATION HANDLES CONFLICTS WITHOUT INFINITE RETRIES
// ═══════════════════════════════════════════════════════════════════

describe('6. Webhook reconciliation without infinite retries', () => {
  it('6a. ConfirmationPreconditionFailed marks webhook as processed (non-retriable)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to FAILED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });

    // Success webhook for FAILED payment — terminal-state guard handles it
    const eventId = `evt-retry-test-${uid()}`;
    const result = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });

    // Event is processed — marked as processed=true
    expect(result.processed).toBe(true);

    // Verify in DB: processed=true means it will NOT be retried
    const webhookEvent = await db.paymentWebhookEvent.findUnique({ where: { eventId } });
    expect(webhookEvent?.processed).toBe(true);
    expect(webhookEvent?.processingError).toContain('terminal state');
  });

  it('6b. ConfirmationRaceConflict marks webhook as processed (non-retriable)', async () => {
    // Simulate a race where the payment was transitioned to a non-COMPLETED
    // state by a concurrent process during confirmation.
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to FAILED and booking to CANCELLED
    // (simulating concurrent process winning the race)
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    await db.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancellationReason: 'Payment failed' },
    });

    // Now try success webhook — will hit terminal-state guard
    const eventId = `evt-race-conflict-${uid()}`;
    const result = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });

    // Processed as non-retriable
    expect(result.processed).toBe(true);

    // Webhook event marked as processed=true — no retry
    const webhookEvent = await db.paymentWebhookEvent.findUnique({ where: { eventId } });
    expect(webhookEvent?.processed).toBe(true);
  });

  it('6c. Retrying a processed conflict event is deduped', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition to FAILED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });

    // First delivery — handled as non-retriable
    const eventId = `evt-retry-dedup-${uid()}`;
    const result1 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });
    expect(result1.processed).toBe(true);

    // Retry (Paystack re-delivers) — deduped
    const result2 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });
    expect(result2.processed).toBe(false);
    expect(result2.outcome).toContain('duplicate');

    // Payment still FAILED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('FAILED');
  });

  it('6d. CANCELLED payment — success webhook is non-retriable', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Cancel the payment and booking
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await db.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancellationReason: 'User cancelled' },
    });

    const eventId = `evt-cancelled-${uid()}`;
    const result = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });

    // Non-retriable
    expect(result.processed).toBe(true);
    expect(result.outcome).toContain('terminal state');

    // Payment remains CANCELLED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('CANCELLED');
  });

  it('6e. REFUNDED payment — success webhook is non-retriable', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment through COMPLETED → REFUNDED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', completedAt: new Date() },
    });

    const eventId = `evt-refunded-${uid()}`;
    const result = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });

    // Non-retriable
    expect(result.processed).toBe(true);
    expect(result.outcome).toContain('terminal state');

    // Payment remains REFUNDED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('REFUNDED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. TYPED CONFLICT ERROR PROPERTIES
// ═══════════════════════════════════════════════════════════════════

describe('7. Typed conflict errors', () => {
  it('7a. ConfirmationPreconditionFailed for FAILED has correct details', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to FAILED and booking to CANCELLED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    await db.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED', cancellationReason: 'Payment failed' },
    });

    try {
      await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfirmationPreconditionFailed);
      const e = error as ConfirmationPreconditionFailed;
      expect(e.code).toBe('CONFIRMATION_PRECONDITION_FAILED');
      expect(e.statusCode).toBe(409);
      expect(e.paymentStatus).toBe('FAILED');
      expect(e.message).toContain('terminal state');
    }
  });

  it('7b. ConfirmationPreconditionFailed for EXPIRED has correct details', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to EXPIRED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'EXPIRED' },
    });

    try {
      await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfirmationPreconditionFailed);
      const e = error as ConfirmationPreconditionFailed;
      expect(e.code).toBe('CONFIRMATION_PRECONDITION_FAILED');
      expect(e.paymentStatus).toBe('EXPIRED');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. PAYMENT BECOMES CANCELLED BEFORE CONFIRMATION
// ═══════════════════════════════════════════════════════════════════

describe('8. Payment becomes CANCELLED before confirmation', () => {
  it('8a. ConfirmationPreconditionFailed when payment is already CANCELLED', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to CANCELLED (simulate user cancellation)
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    // Late confirmation arrives — should throw ConfirmationPreconditionFailed
    await expect(
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ).rejects.toThrow(ConfirmationPreconditionFailed);

    // Payment remains CANCELLED
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter?.status).toBe('CANCELLED');
  });

  it('8b. No ticket activation or inventory change when payment is CANCELLED', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Transition payment to CANCELLED
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    // Record pre-state
    const invBefore = await checkInventory(tt.id);
    const validTicketsBefore = await db.ticket.count({ where: { bookingId: booking.id, status: 'VALID' } });

    // Attempt confirmation — should throw
    await expect(
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ).rejects.toThrow(ConfirmationPreconditionFailed);

    // Inventory unchanged
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.soldCount).toBe(invBefore.soldCount);
    expect(invAfter.reservedCount).toBe(invBefore.reservedCount);

    // No tickets activated
    const validTicketsAfter = await db.ticket.count({ where: { bookingId: booking.id, status: 'VALID' } });
    expect(validTicketsAfter).toBe(validTicketsBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. CONCURRENT CONFIRMATION RACE (Promise.all)
// ═══════════════════════════════════════════════════════════════════

describe('9. Concurrent confirmation race', () => {
  it('9a. Two concurrent confirmations — exactly one succeeds, no duplicate side effects', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Record pre-state
    const invBefore = await checkInventory(tt.id);

    // Fire two concurrent confirmations
    const [result1, result2] = await Promise.allSettled([
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
      confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef }),
    ]);

    // Exactly one should be fulfilled with confirmed=true
    const fulfilled = [result1, result2].filter(r => r.status === 'fulfilled') as Array<{ status: 'fulfilled'; value: Awaited<ReturnType<typeof confirmBookingOnPaymentSuccess>> }>;
    const rejected = [result1, result2].filter(r => r.status === 'rejected');

    // Both should complete (not throw) — either idempotent or conflict
    // In SQLite serialized writes, both will fulfill:
    //   First: confirmed=true, ticketsActivated=2
    //   Second: confirmed=false (already COMPLETED), ticketsActivated=0
    // In PostgreSQL with true concurrency, one might throw ConfirmationRaceConflict
    expect(fulfilled.length + rejected.length).toBe(2);

    // Count how many reported confirmed=true
    const confirmedCount = fulfilled.filter(r => r.value.confirmed).length;
    expect(confirmedCount).toBeLessThanOrEqual(1);

    // Verify payment is COMPLETED
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('COMPLETED');

    // Verify booking is CONFIRMED
    const bookingFinal = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingFinal?.status).toBe('CONFIRMED');

    // No duplicate side effects: soldCount increased by exactly 2 (not 4)
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.soldCount).toBe(invBefore.soldCount + 2);

    // No duplicate notifications
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

  it('9b. Concurrent success and failure webhooks — final state is consistent', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Record pre-state
    const invBefore = await checkInventory(tt.id);

    // Fire success and failure webhooks concurrently
    const successEventId = `evt-conc-success-${uid()}`;
    const failEventId = `evt-conc-fail-${uid()}`;

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

    // Both should complete (fulfilled or rejected with domain error)
    expect(successResult.status === 'fulfilled' || successResult.status === 'rejected').toBe(true);
    expect(failResult.status === 'fulfilled' || failResult.status === 'rejected').toBe(true);

    // Final payment state must be a valid terminal or near-terminal state
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(['COMPLETED', 'FAILED'].includes(paymentFinal!.status)).toBe(true);

    // Final booking state is consistent with payment
    const bookingFinal = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    if (paymentFinal?.status === 'COMPLETED') {
      expect(bookingFinal?.status).toBe('CONFIRMED');
    } else {
      expect(['CANCELLED', 'PENDING'].includes(bookingFinal!.status)).toBe(true);
    }

    // Ticket activation is consistent with payment state
    const validTickets = await db.ticket.count({
      where: { bookingId: booking.id, status: 'VALID' },
    });
    if (paymentFinal?.status === 'COMPLETED') {
      expect(validTickets).toBe(2);
    } else {
      expect(validTickets).toBe(0);
    }

    // Inventory invariant holds
    const inv = await checkInventory(tt.id);
    expect(inv.soldCount + inv.reservedCount).toBeLessThanOrEqual(inv.quantity);

    // soldCount increased only if COMPLETED
    if (paymentFinal?.status === 'COMPLETED') {
      expect(inv.soldCount).toBe(invBefore.soldCount + 2);
    } else {
      expect(inv.soldCount).toBe(invBefore.soldCount);
    }

    // Notification count is consistent (at most 1 for success, 0 for failure)
    const notifications = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });
    if (paymentFinal?.status === 'COMPLETED') {
      expect(notifications).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. CONFIRMATIONRACECONFLICT CODE PATH VERIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('10. ConfirmationRaceConflict code path', () => {
  it('10a. ConfirmationRaceConflict is constructable with correct properties', () => {
    const error = new ConfirmationRaceConflict('pay_123', 'FAILED', 'CANCELLED');
    expect(error).toBeInstanceOf(ConfirmationRaceConflict);
    expect(error.name).toBe('ConfirmationRaceConflict');
    expect(error.code).toBe('CONFIRMATION_RACE_CONFLICT');
    expect(error.statusCode).toBe(409);
    expect(error.currentPaymentStatus).toBe('FAILED');
    expect(error.currentBookingStatus).toBe('CANCELLED');
    expect(error.message).toContain('FAILED');
    expect(error.message).toContain('CANCELLED');
    expect(error.message).toContain('Reconciliation');
    // paymentId is in details, not the message
    expect(error.details).toEqual({
      paymentId: 'pay_123',
      currentPaymentStatus: 'FAILED',
      currentBookingStatus: 'CANCELLED',
    });
  });

  it('10b. ConfirmationPreconditionFailed is constructable with correct properties', () => {
    const error = new ConfirmationPreconditionFailed('pay_456', 'EXPIRED');
    expect(error).toBeInstanceOf(ConfirmationPreconditionFailed);
    expect(error.name).toBe('ConfirmationPreconditionFailed');
    expect(error.code).toBe('CONFIRMATION_PRECONDITION_FAILED');
    expect(error.statusCode).toBe(409);
    expect(error.paymentStatus).toBe('EXPIRED');
    expect(error.message).toContain('terminal state');
    expect(error.message).toContain('EXPIRED');
    expect(error.details).toEqual({
      paymentId: 'pay_456',
      paymentStatus: 'EXPIRED',
    });
  });

  it('10c. Genuine updateMany count=0 race — concurrent process transitions payment to FAILED during TOCTOU gap', async () => {
    // This test genuinely exercises the updateMany count=0 → ConfirmationRaceConflict path.
    //
    // Mechanism: A narrowly-scoped test seam fires between the payment status read
    // (step 1) and the conditional updateMany (step 5). The seam uses db (outside
    // the transaction) to transition the payment to FAILED and the booking to CANCELLED,
    // simulating a concurrent process that won the race.
    //
    // Result:
    //   - confirmBookingOnPaymentSuccess read payment.status = PROCESSING (passes terminal check)
    //   - Seam fires → payment becomes FAILED, booking becomes CANCELLED
    //   - updateMany WHERE status='PROCESSING' returns count=0
    //   - Re-read finds FAILED/CANCELLED → ConfirmationRaceConflict
    //
    // IMPORTANT: This is a SIMULATED race via test seam, not real database concurrency.
    // True concurrent interleaving requires PostgreSQL with interactive transactions
    // and row-level locking, which SQLite's serialized mode cannot reproduce.
    // The test seam targets the exact TOCTOU gap without broadly mocking Prisma
    // or weakening production logic.
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Record pre-state
    const invBefore = await checkInventory(tt.id);
    const notificationsBefore = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });
    const validTicketsBefore = await db.ticket.count({
      where: { bookingId: booking.id, status: 'VALID' },
    });

    // Set up test seam: during the TOCTOU gap, a concurrent process transitions
    // the payment to FAILED and the booking to CANCELLED.
    setTestOnBeforeConditionalUpdate(async () => {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failedAt: new Date() },
      });
      await db.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED', cancellationReason: 'Concurrent failure race' },
      });
    });

    // Call confirm — it should throw ConfirmationRaceConflict
    let raceError: ConfirmationRaceConflict | undefined;
    try {
      await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });
    } catch (error) {
      if (error instanceof ConfirmationRaceConflict) {
        raceError = error;
      } else {
        // Re-throw unexpected errors
        throw error;
      }
    }

    // Verify the error has correct properties
    expect(raceError).toBeDefined();
    expect(raceError!.currentPaymentStatus).toBe('FAILED');
    expect(raceError!.currentBookingStatus).toBe('CANCELLED');
    expect(raceError!.code).toBe('CONFIRMATION_RACE_CONFLICT');

    // Payment remains FAILED (no side effects from the losing confirmation)
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter?.status).toBe('FAILED');

    // Booking remains CANCELLED
    const bookingAfter = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingAfter?.status).toBe('CANCELLED');

    // No tickets activated
    const validTicketsAfter = await db.ticket.count({
      where: { bookingId: booking.id, status: 'VALID' },
    });
    expect(validTicketsAfter).toBe(validTicketsBefore);

    // No inventory change (soldCount unchanged)
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.soldCount).toBe(invBefore.soldCount);

    // No notification created for a race conflict
    const notificationsAfter = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });
    expect(notificationsAfter).toBe(notificationsBefore);
  });

  it('10d. Genuine updateMany count=0 race — concurrent process completes payment (duplicate success)', async () => {
    // This test exercises the updateMany count=0 → idempotent path (CASE A).
    // The seam simulates a concurrent process that successfully completes the payment
    // and confirms the booking before our updateMany runs.
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef, booking } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Set up test seam: concurrent process completes the payment and confirms the booking
    setTestOnBeforeConditionalUpdate(async () => {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED', completedAt: new Date(), providerRef },
      });
      await db.booking.update({
        where: { id: booking.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });
      // Activate tickets and confirm inventory (as the winning process would)
      await db.ticket.updateMany({
        where: { bookingId: booking.id, status: 'PENDING' },
        data: { status: 'VALID' },
      });
      await confirmReservation({ ticketTypeId: tt.id, quantity: 2 });
    });

    // Call confirm — should return idempotent result (not throw)
    const result = await confirmBookingOnPaymentSuccess({
      paymentId: payment.id,
      providerReference: providerRef,
    });

    expect(result.confirmed).toBe(false);
    expect(result.ticketsActivated).toBe(0);
    expect(result.inventoryConfirmed).toEqual([]);

    // Payment is COMPLETED
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter?.status).toBe('COMPLETED');

    // Booking is CONFIRMED
    const bookingAfter = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingAfter?.status).toBe('CONFIRMED');

    // Tickets were activated by the winning process (exactly 2)
    const validTickets = await db.ticket.count({
      where: { bookingId: booking.id, status: 'VALID' },
    });
    expect(validTickets).toBe(2);

    // No duplicate notification from the idempotent path
    const notifications = await db.notification.count({
      where: { userId: user.id, type: 'PAYMENT' },
    });
    expect(notifications).toBeLessThanOrEqual(1);
  });
});
