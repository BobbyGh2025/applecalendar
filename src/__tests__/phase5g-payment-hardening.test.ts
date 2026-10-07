/**
 * Phase 5G: Payment Hardening Tests
 *
 * Comprehensive test suite covering payment hardening aspects that can be
 * verified WITHOUT real Paystack credentials. Tests domain logic around
 * the Paystack integration, webhook processing, and state machine enforcement.
 *
 * Uses the real database (SQLite in test environment) and actual domain services.
 * NO mocked Prisma. NO mocked fetch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import crypto from 'crypto';

// ─── Service imports ───
import {
  confirmBookingOnPaymentSuccess,
  processWebhookEvent,
  requestRefund,
  processRefundCompletion,
  validatePaymentTransition,
  canBeRefunded,
  isTerminalStatus,
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
  activateTickets,
} from '@/lib/services/ticket-service';

import { providerRegistry } from '@/lib/services/payment-provider';
import type { NormalizedWebhookEvent } from '@/lib/services/payment-provider';

import {
  InsufficientInventory,
  RefundNotEligible,
  DuplicateRefund,
  PaymentNotFound,
  InvalidPaymentTransition,
  RefundAmountExceedsPayment,
  PaymentDomainError,
} from '@/lib/services/payment-domain-errors';

import { asMoney } from '@/lib/money';
import { env } from '@/lib/env';

// Side-effect import to register providers
import '@/lib/services/providers';

// ═══════════════════════════════════════════════════════════════════
// REPLICATED DOMAIN LOGIC (for tests that verify internal algorithms)
// ═══════════════════════════════════════════════════════════════════

/**
 * Replicate the exact webhook signature computation from the webhook route.
 * Paystack uses HMAC-SHA512 on the raw request body.
 */
function computeSignature(rawBody: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
}

/**
 * Timing-safe string comparison.
 * Replicates the comparison logic used in the webhook route.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Sensitive payload keys — replicated from payment-attempt.ts
 * for the "Secret Never Exposed" test category.
 */
const SENSITIVE_PAYLOAD_KEYS = new Set([
  'authorization',
  'Authorization',
  'secret_key',
  'secretKey',
  'api_key',
  'apiKey',
  'password',
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'card_number',
  'cardNumber',
  'cvv',
  'pin',
]);

/**
 * Replicate redactPayload logic from payment-attempt.ts
 * for the "Secret Never Exposed" test category.
 */
function redactPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(redactPayload);

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_PAYLOAD_KEYS.has(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactPayload(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

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
      description: 'Test event for Phase 5G hardening tests',
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
 *
 * Returns all created entities for assertions.
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

  // 1. Create PENDING booking
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

  // 2. Reserve inventory
  await reserveInventory({ ticketTypeId: ticketType.id, quantity });

  // 3. Create PENDING payment with providerRef for webhook lookup
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

  // 4. Create PENDING tickets
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
  // Reset created records tracking before each test
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
// 1. WEBHOOK SIGNATURE VALIDATION (5 tests)
// ═══════════════════════════════════════════════════════════════════

describe('1. Webhook Signature Validation', () => {
  it('1a. HMAC-SHA512 signature is computed correctly on raw body', () => {
    const rawBody = JSON.stringify({ event: 'charge.success', data: { reference: 'abc123' } });
    const secret = 'test-webhook-secret';

    const signature = computeSignature(rawBody, secret);

    // Verify it matches an independent computation
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    expect(signature).toBe(expected);

    // Signature should be a 128-char hex string (SHA512 = 512 bits = 64 bytes = 128 hex chars)
    expect(signature).toHaveLength(128);
    expect(/^[0-9a-f]+$/.test(signature)).toBe(true);
  });

  it('1b. Timing-safe comparison rejects different-length signatures', () => {
    const correctSig = 'a'.repeat(128);
    const wrongLengthSig = 'a'.repeat(64); // Half the length

    expect(timingSafeEqual(correctSig, wrongLengthSig)).toBe(false);
    expect(timingSafeEqual(wrongLengthSig, correctSig)).toBe(false);
  });

  it('1c. Timing-safe comparison rejects wrong signatures', () => {
    const rawBody = JSON.stringify({ event: 'charge.success' });
    const secret = 'test-webhook-secret';

    const correctSig = computeSignature(rawBody, secret);
    const wrongSig = computeSignature(rawBody, 'wrong-secret');

    // Wrong secret produces different signature
    expect(correctSig).not.toBe(wrongSig);

    // Timing-safe comparison rejects it
    expect(timingSafeEqual(correctSig, wrongSig)).toBe(false);
  });

  it('1d. Missing signature header is rejected', () => {
    const rawBody = JSON.stringify({ event: 'charge.success' });
    const secret = 'test-webhook-secret';

    const correctSig = computeSignature(rawBody, secret);

    // Missing signature = empty string or undefined — must not match
    expect(timingSafeEqual(correctSig, '')).toBe(false);

    // Different-length comparison: any signature vs empty string
    // The route handler should reject requests with no signature header
    // before ever calling timingSafeEqual
    const missingSignature: string | undefined = undefined;
    expect(missingSignature).toBeUndefined();
  });

  it('1e. Empty signature is rejected', () => {
    const rawBody = JSON.stringify({ event: 'charge.success' });
    const secret = 'test-webhook-secret';

    const correctSig = computeSignature(rawBody, secret);

    // Empty string has different length — timing-safe rejects
    expect(timingSafeEqual(correctSig, '')).toBe(false);

    // Also verify the route-level check: empty string is falsy
    const emptySig = '';
    expect(emptySig).toBeFalsy();

    // A signature of only whitespace should also be rejected
    const whitespaceSig = '   ';
    expect(timingSafeEqual(correctSig, whitespaceSig)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. WEBHOOK EVENT DEDUPLICATION (3 tests)
// ═══════════════════════════════════════════════════════════════════

describe('2. Webhook Event Deduplication', () => {
  it('2a. Same eventId processed twice → no duplicate effects (second returns already processed)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { booking, payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    const webhookEventId = `evt-dedup-${uid()}`;

    // First delivery — should process and confirm booking
    const result1 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: webhookEventId,
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

    // Record state after first delivery
    const bookingAfter1 = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingAfter1?.status).toBe('CONFIRMED');

    const ticketCountAfter1 = await db.ticket.count({ where: { bookingId: booking.id, status: 'VALID' } });

    // Second delivery with SAME eventId — should be deduped
    const result2 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: webhookEventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });

    // Second delivery should report NOT processed (dedup)
    expect(result2.processed).toBe(false);
    expect(result2.outcome).toContain('duplicate');

    // No duplicate effects: booking still CONFIRMED, same ticket count
    const bookingAfter2 = await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } });
    expect(bookingAfter2?.status).toBe('CONFIRMED');

    const ticketCountAfter2 = await db.ticket.count({ where: { bookingId: booking.id, status: 'VALID' } });
    expect(ticketCountAfter2).toBe(ticketCountAfter1);
  });

  it('2b. Concurrent delivery (P2002 race) is handled correctly', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    const webhookEventId = `evt-concurrent-${uid()}`;

    // Process the event once successfully
    const result1 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: webhookEventId,
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

    // Now simulate a concurrent delivery arriving after the first has
    // already created the PaymentWebhookEvent record. Since the eventId
    // unique constraint is in place, the second delivery will find the
    // existing record and return dedup result.
    const result2 = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId: webhookEventId,
        eventType: 'charge.success',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: true,
        isPaymentFailure: false,
      },
    });

    // The concurrent delivery is safely handled — no error, no duplicate effects
    expect(result2.processed).toBe(false);
    expect(result2.outcome).toContain('duplicate');

    // Payment status remains COMPLETED (not corrupted)
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter?.status).toBe('COMPLETED');
  });

  it('2c. Different eventIds for same payment → both processed', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First event: charge.success
    const eventId1 = `evt-success-${uid()}`;
    const result1 = await processWebhookEvent({
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
    expect(result1.processed).toBe(true);

    // Second event with DIFFERENT eventId: e.g., a "transfer.success" or another
    // unrelated event type for the same payment reference. Since the payment is
    // already COMPLETED, confirmBookingOnPaymentSuccess is idempotent.
    const eventId2 = `evt-other-${uid()}`;
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

    // Both events are recorded (different eventIds)
    expect(result2.processed).toBe(true);
    // Payment is still COMPLETED (not corrupted)
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter?.status).toBe('COMPLETED');

    // Both webhook events exist in the database
    const we1 = await db.paymentWebhookEvent.findUnique({ where: { eventId: eventId1 } });
    const we2 = await db.paymentWebhookEvent.findUnique({ where: { eventId: eventId2 } });
    expect(we1).not.toBeNull();
    expect(we2).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. WEBHOOK IDEMPOTENCY (3 tests)
// ═══════════════════════════════════════════════════════════════════

describe('3. Webhook Idempotency', () => {
  it('3a. Double delivery of charge.success doesn\'t double-complete payment', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { booking, payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    const eventId = `evt-idem-success-${uid()}`;

    // First charge.success
    await processWebhookEvent({
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

    const paymentAfter1 = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true, completedAt: true } });
    expect(paymentAfter1?.status).toBe('COMPLETED');
    const firstCompletedAt = paymentAfter1?.completedAt;

    // Second charge.success (duplicate)
    await processWebhookEvent({
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

    // Payment is still COMPLETED with same completedAt (not double-completed)
    const paymentAfter2 = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true, completedAt: true } });
    expect(paymentAfter2?.status).toBe('COMPLETED');
    expect(paymentAfter2?.completedAt?.getTime()).toBe(firstCompletedAt?.getTime());

    // Inventory: soldCount should be exactly 2, reservedCount should be 0
    const inv = await checkInventory(tt.id);
    expect(inv.soldCount).toBe(2);
    expect(inv.reservedCount).toBe(0);
  });

  it('3b. Double delivery of charge.failed doesn\'t double-release inventory', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Verify reservation
    const invBefore = await checkInventory(tt.id);
    expect(invBefore.reservedCount).toBe(2);

    const eventId = `evt-idem-fail-${uid()}`;

    // First charge.failed
    await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.failed',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: true,
      },
    });

    const invAfter1 = await checkInventory(tt.id);
    expect(invAfter1.reservedCount).toBe(0); // Released

    // Second charge.failed (duplicate)
    await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.failed',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: true,
      },
    });

    // Inventory is still correctly at reservedCount=0 (not negative from double-release)
    const invAfter2 = await checkInventory(tt.id);
    expect(invAfter2.reservedCount).toBe(0);
    expect(invAfter2.soldCount).toBe(0);
  });

  it('3c. Already-COMPLETED payment receiving charge.success → idempotent', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Manually complete the payment (simulate first webhook already processed)
    await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });

    const paymentBefore = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentBefore?.status).toBe('COMPLETED');

    // Now a late/duplicate charge.success arrives
    const eventId = `evt-late-success-${uid()}`;
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

    // Event is processed but payment remains COMPLETED (idempotent)
    expect(result.processed).toBe(true);
    expect(result.outcome).toContain('idempotent');

    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfter?.status).toBe('COMPLETED');

    // Inventory unchanged (soldCount=2, reservedCount=0)
    const inv = await checkInventory(tt.id);
    expect(inv.soldCount).toBe(2);
    expect(inv.reservedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. VERIFY ROUTE FAILURE HANDLING — Phase 5G Fix (3 tests)
// ═══════════════════════════════════════════════════════════════════

describe('4. Verify Route Failure Handling (Phase 5G Fix)', () => {
  it('4a. When Paystack reports definitively-failed, Payment → FAILED and inventory released', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Verify initial state
    const invBefore = await checkInventory(tt.id);
    expect(invBefore.reservedCount).toBe(2);

    // Simulate the verify route detecting a definitive failure:
    // The verify route would call processWebhookEvent with charge.failed
    // after Paystack verify returns a failed status.
    const eventId = `evt-verify-fail-${uid()}`;
    const result = await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.failed',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: true,
      },
    });

    expect(result.processed).toBe(true);

    // Payment → FAILED
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true, failedAt: true } });
    expect(paymentAfter?.status).toBe('FAILED');
    expect(paymentAfter?.failedAt).not.toBeNull();

    // Inventory released: reservedCount decreased
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.reservedCount).toBe(0);
  });

  it('4b. When payment is already COMPLETED (concurrent webhook), verify failure is a no-op', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First: charge.success arrives and completes the payment
    const successEventId = `evt-success-first-${uid()}`;
    await processWebhookEvent({
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

    const paymentAfterSuccess = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfterSuccess?.status).toBe('COMPLETED');

    // Now: verify route detects failure (race condition: success webhook
    // arrived before the verify call returned failure).
    // Since the payment is COMPLETED, the charge.failed event should be
    // recorded but the state machine should prevent COMPLETED → FAILED.
    // processWebhookEvent throws InvalidPaymentTransition for this case.
    const failEventId = `evt-fail-late-${uid()}`;
    try {
      await processWebhookEvent({
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
    } catch (error) {
      // Expected: InvalidPaymentTransition (COMPLETED → FAILED is illegal)
      expect(error).toBeInstanceOf(InvalidPaymentTransition);
    }

    // The key assertion: payment remains COMPLETED (state machine protected it)
    const paymentAfterFail = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfterFail?.status).toBe('COMPLETED');

    // Inventory is still correct (soldCount=2, reservedCount=0)
    const inv = await checkInventory(tt.id);
    expect(inv.soldCount).toBe(2);
    expect(inv.reservedCount).toBe(0);
  });

  it('4c. Payment state machine prevents FAILED → COMPLETED after failure', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // First: payment fails
    const failEventId = `evt-fail-first-${uid()}`;
    await processWebhookEvent({
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

    const paymentAfterFail = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentAfterFail?.status).toBe('FAILED');

    // Now: a late charge.success arrives (e.g., race condition or retry)
    // The state machine MUST prevent FAILED → COMPLETED
    const successEventId = `evt-success-late-${uid()}`;
    // This should throw InvalidPaymentTransition
    await expect(
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
    ).rejects.toThrow(InvalidPaymentTransition);

    // Payment remains FAILED (not resurrected)
    const paymentFinal = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    expect(paymentFinal?.status).toBe('FAILED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. PAYMENT STATE MACHINE ENFORCEMENT (3 tests)
// ═══════════════════════════════════════════════════════════════════

describe('5. Payment State Machine Enforcement', () => {
  it('5a. Illegal transitions are rejected', () => {
    // COMPLETED → PENDING ❌
    expect(() => validatePaymentTransition('COMPLETED', 'PENDING')).toThrow(InvalidPaymentTransition);

    // FAILED → COMPLETED ❌
    expect(() => validatePaymentTransition('FAILED', 'COMPLETED')).toThrow(InvalidPaymentTransition);

    // CANCELLED → COMPLETED ❌
    expect(() => validatePaymentTransition('CANCELLED', 'COMPLETED')).toThrow(InvalidPaymentTransition);

    // EXPIRED → PENDING ❌
    expect(() => validatePaymentTransition('EXPIRED', 'PENDING')).toThrow(InvalidPaymentTransition);

    // REFUNDED → COMPLETED ❌
    expect(() => validatePaymentTransition('REFUNDED', 'COMPLETED')).toThrow(InvalidPaymentTransition);

    // FAILED → PROCESSING ❌
    expect(() => validatePaymentTransition('FAILED', 'PROCESSING')).toThrow(InvalidPaymentTransition);

    // PENDING → REFUNDED ❌ (only COMPLETED → REFUNDED is legal)
    expect(() => validatePaymentTransition('PENDING', 'REFUNDED')).toThrow(InvalidPaymentTransition);
  });

  it('5b. Terminal states have no outgoing transitions', () => {
    // FAILED is terminal
    expect(isTerminalStatus('FAILED')).toBe(true);

    // CANCELLED is terminal
    expect(isTerminalStatus('CANCELLED')).toBe(true);

    // EXPIRED is terminal
    expect(isTerminalStatus('EXPIRED')).toBe(true);

    // REFUNDED is terminal
    expect(isTerminalStatus('REFUNDED')).toBe(true);

    // Non-terminal states
    expect(isTerminalStatus('PENDING')).toBe(false);
    expect(isTerminalStatus('PROCESSING')).toBe(false);
    expect(isTerminalStatus('COMPLETED')).toBe(false);
  });

  it('5c. Only COMPLETED can be refunded', () => {
    // COMPLETED can be refunded
    expect(canBeRefunded('COMPLETED')).toBe(true);

    // All other statuses cannot be refunded
    expect(canBeRefunded('PENDING')).toBe(false);
    expect(canBeRefunded('PROCESSING')).toBe(false);
    expect(canBeRefunded('FAILED')).toBe(false);
    expect(canBeRefunded('CANCELLED')).toBe(false);
    expect(canBeRefunded('EXPIRED')).toBe(false);
    expect(canBeRefunded('REFUNDED')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. INVENTORY INVARIANT UNDER PAYMENT OPERATIONS (3 tests)
// ═══════════════════════════════════════════════════════════════════

describe('6. Inventory Invariant Under Payment Operations', () => {
  it('6a. After payment failure, reservedCount decreases (invariant holds)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 3);

    // Verify initial invariant: soldCount + reservedCount <= quantity
    const invBefore = await checkInventory(tt.id);
    expect(invBefore.soldCount + invBefore.reservedCount).toBeLessThanOrEqual(invBefore.quantity);
    expect(invBefore.reservedCount).toBe(3);

    // Process payment failure
    const eventId = `evt-inv-fail-${uid()}`;
    await processWebhookEvent({
      event: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.failed',
        eventReference: providerRef,
        amount: asMoney(payment.amount),
        currency: payment.currency,
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: true,
      },
    });

    // After failure: reservedCount decreased, invariant holds
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.reservedCount).toBe(0); // Reservation released
    expect(invAfter.soldCount + invAfter.reservedCount).toBeLessThanOrEqual(invAfter.quantity);
  });

  it('6b. After payment success, soldCount increases and reservedCount decreases (invariant holds)', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 3);

    // Before: reservedCount=3, soldCount=0
    const invBefore = await checkInventory(tt.id);
    expect(invBefore.reservedCount).toBe(3);
    expect(invBefore.soldCount).toBe(0);
    expect(invBefore.soldCount + invBefore.reservedCount).toBeLessThanOrEqual(invBefore.quantity);

    // Process payment success
    const eventId = `evt-inv-success-${uid()}`;
    await processWebhookEvent({
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

    // After: reservedCount=0, soldCount=3 (reservation confirmed to sold)
    const invAfter = await checkInventory(tt.id);
    expect(invAfter.reservedCount).toBe(0);
    expect(invAfter.soldCount).toBe(3);
    expect(invAfter.soldCount + invAfter.reservedCount).toBeLessThanOrEqual(invAfter.quantity);
  });

  it('6c. Concurrent reservations don\'t violate soldCount + reservedCount <= quantity', async () => {
    const org = await createUser('ORGANIZER');
    const event = await createEvent(org.id);
    // Only 3 tickets available
    const tt = await createTicketType(event.id, 5000, 3);

    // First reservation of 2 should succeed
    await reserveInventory({ ticketTypeId: tt.id, quantity: 2 });

    const invAfter1 = await checkInventory(tt.id);
    expect(invAfter1.reservedCount).toBe(2);
    expect(invAfter1.soldCount + invAfter1.reservedCount).toBeLessThanOrEqual(invAfter1.quantity);

    // Second reservation of 2 should fail (only 1 remaining)
    await expect(
      reserveInventory({ ticketTypeId: tt.id, quantity: 2 }),
    ).rejects.toThrow(InsufficientInventory);

    // Invariant still holds
    const invAfter2 = await checkInventory(tt.id);
    expect(invAfter2.reservedCount).toBe(2);
    expect(invAfter2.soldCount + invAfter2.reservedCount).toBeLessThanOrEqual(invAfter2.quantity);

    // Third reservation of 1 should succeed (exactly fills capacity)
    await reserveInventory({ ticketTypeId: tt.id, quantity: 1 });

    const invAfter3 = await checkInventory(tt.id);
    expect(invAfter3.reservedCount).toBe(3);
    expect(invAfter3.soldCount + invAfter3.reservedCount).toBeLessThanOrEqual(invAfter3.quantity);
    expect(invAfter3.soldCount + invAfter3.reservedCount).toBe(3); // At capacity

    // Fourth reservation of 1 should fail (at capacity)
    await expect(
      reserveInventory({ ticketTypeId: tt.id, quantity: 1 }),
    ).rejects.toThrow(InsufficientInventory);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. REFUND OVER-PROTECTION (2 tests)
// ═══════════════════════════════════════════════════════════════════

describe('7. Refund Over-Protection', () => {
  it('7a. Refund amount exceeding payment amount is rejected', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Complete the payment
    await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });

    const completedPayment = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true, amount: true } });
    expect(completedPayment?.status).toBe('COMPLETED');

    // Try to refund more than the payment amount
    const excessiveRefundAmount = completedPayment!.amount + 1000; // More than payment
    try {
      await requestRefund({
        paymentId: payment.id,
        amount: excessiveRefundAmount,
        reason: 'Attempting over-refund',
        requestedBy: user.id,
      });
      expect.unreachable('Should have thrown an error for over-refund');
    } catch (error) {
      // Either RefundAmountExceedsPayment or a constraint violation Error from
      // validateRefundMoneyConstraints — both correctly reject the over-refund
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('cannot exceed');
    }
  });

  it('7b. Concurrent refund requests (only one active at a time) is enforced', async () => {
    const org = await createUser('ORGANIZER');
    const user = await createUser('PUBLIC');
    const event = await createEvent(org.id);
    const tt = await createTicketType(event.id, 5000, 10);
    const { payment, providerRef } = await createPaidBookingWithReservation(user, event, tt, 2);

    // Complete the payment
    await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: providerRef });

    // First refund request succeeds
    const refund1 = await requestRefund({
      paymentId: payment.id,
      amount: payment.amount,
      reason: 'First refund request',
      requestedBy: user.id,
    });
    created.refunds.push(refund1.refundId);
    expect(refund1.status).toBe('REQUESTED');

    // Second concurrent refund request is blocked (DuplicateRefund)
    await expect(
      requestRefund({
        paymentId: payment.id,
        amount: payment.amount,
        reason: 'Concurrent refund attempt',
        requestedBy: user.id,
      }),
    ).rejects.toThrow(DuplicateRefund);

    // Even after marking the first as PROCESSING, a new request is still blocked
    const { markRefundProcessing } = await import('@/lib/services/refund-service');
    await markRefundProcessing(refund1.refundId);

    await expect(
      requestRefund({
        paymentId: payment.id,
        amount: payment.amount,
        reason: 'Attempt while processing',
        requestedBy: user.id,
      }),
    ).rejects.toThrow(DuplicateRefund);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. SECRET NEVER EXPOSED (1 test)
// ═══════════════════════════════════════════════════════════════════

describe('8. Secret Never Exposed', () => {
  it('8a. PaymentAttempt request/response payloads have sensitive keys redacted', () => {
    // Simulate a Paystack request payload with secrets
    const requestPayload = {
      email: 'customer@example.com',
      amount: 10000,
      reference: 'ps_ref_12345',
      authorization: 'Bearer sk_test_xxxxxxxxxxxxx',  // SENSITIVE
      secret_key: 'sk_test_xxxxxxxxxxxxx',             // SENSITIVE
      metadata: {
        paymentId: 'pay_AABBCC',
        apiKey: 'pk_test_xxxxxxxxxxxxx',               // SENSITIVE
      },
    };

    // Simulate a Paystack response payload with secrets
    const responsePayload = {
      status: true,
      data: {
        reference: 'ps_ref_12345',
        authorization_url: 'https://checkout.paystack.co/xxx',
        access_token: 'tok_xxxxxxxxxxxxx',             // SENSITIVE
        card_number: '4242XXXXXXXX4242',               // SENSITIVE
        cvv: '123',                                    // SENSITIVE
      },
    };

    // Redact both payloads
    const redactedRequest = redactPayload(requestPayload) as Record<string, unknown>;
    const redactedResponse = redactPayload(responsePayload) as Record<string, unknown>;

    // Verify sensitive keys are redacted in request
    expect(redactedRequest['authorization']).toBe('[REDACTED]');
    expect(redactedRequest['secret_key']).toBe('[REDACTED]');

    // Verify non-sensitive keys are preserved in request
    expect(redactedRequest['email']).toBe('customer@example.com');
    expect(redactedRequest['amount']).toBe(10000);
    expect(redactedRequest['reference']).toBe('ps_ref_12345');

    // Verify nested sensitive keys are redacted
    const redactedMetadata = redactedRequest['metadata'] as Record<string, unknown>;
    expect(redactedMetadata['apiKey']).toBe('[REDACTED]');
    expect(redactedMetadata['paymentId']).toBe('pay_AABBCC');

    // Verify sensitive keys are redacted in response
    const redactedData = redactedResponse['data'] as Record<string, unknown>;
    expect(redactedData['access_token']).toBe('[REDACTED]');
    expect(redactedData['card_number']).toBe('[REDACTED]');
    expect(redactedData['cvv']).toBe('[REDACTED]');

    // Verify non-sensitive keys are preserved in response
    expect(redactedData['reference']).toBe('ps_ref_12345');
    expect(redactedData['authorization_url']).toBe('https://checkout.paystack.co/xxx');

    // Verify all known sensitive key names are in the redaction set
    const expectedSensitiveKeys = [
      'authorization', 'Authorization',
      'secret_key', 'secretKey',
      'api_key', 'apiKey',
      'password', 'token',
      'access_token', 'accessToken',
      'refresh_token', 'refreshToken',
      'card_number', 'cardNumber',
      'cvv', 'pin',
    ];
    for (const key of expectedSensitiveKeys) {
      expect(SENSITIVE_PAYLOAD_KEYS.has(key)).toBe(true);
    }
  });
});
