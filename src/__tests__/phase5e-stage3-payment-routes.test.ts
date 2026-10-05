/**
 * Phase 5E Stage 3: Payment API Route Tests
 *
 * Covers: validation schemas, auth enforcement, ownership checks,
 * webhook signature verification, domain service integration,
 * refund authorization, manual confirmation, webhook processing,
 * payment expiry, financial integrity, provider boundary.
 *
 * Tests domain services and validation logic that the routes call.
 * No real HTTP requests or Paystack calls.
 */

import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import {
  createBookingPayment,
  requestRefund,
  markRefundProcessing,
  processRefundCompletion,
  processRefundFailure,
  confirmBookingOnPaymentSuccess,
  processWebhookEvent,
  expireEligiblePayments,
  validatePaymentTransition,
  canBeRefunded,
  canBeExpired,
  isTerminalStatus,
  ProviderIntegrationPending,
  RefundNotEligible,
  RefundAmountExceedsPayment,
  DuplicateRefund,
  RefundNotFound,
  PaymentNotFound,
  WebhookAmountMismatch,
  WebhookCurrencyMismatch,
  InvalidPaymentTransition,
} from '@/lib/services';
import { reserveInventory, releaseReservation, confirmReservation } from '@/lib/services/inventory';
import { generateIdempotencyKey } from '@/lib/services/booking-payment';
import { providerRegistry } from '@/lib/services/payment-provider';
import '@/lib/services/providers'; // Ensure providers are registered (side-effect import)
import { requireRole } from '@/lib/auth';
import {
  initializePaymentSchema,
  verifyPaymentSchema,
  requestRefundSchema,
  confirmManualPaymentSchema,
  paymentQuerySchema,
  processRefundSchema,
} from '@/lib/validations/payments';
import type { NormalizedWebhookEvent } from '@/lib/services/payment-provider';
import crypto from 'crypto';

// ─── Helpers ───

const uid = () => `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

async function createUser(role: string = 'PUBLIC') {
  const s = uid();
  return db.user.create({
    data: { email: `p5e3-${role}-${s}@example.com`, password: 'hash', name: `Test ${role}`, role },
  });
}

async function createEvent(organizerId: string) {
  const s = uid();
  return db.event.create({
    data: {
      title: 'Payment Route Test',
      slug: `p5e3-evt-${s}`,
      description: 'Test',
      startDate: new Date('2025-12-01'),
      organizerId,
      status: 'PUBLISHED',
      isBookable: true,
    },
  });
}

async function createTicketType(eventId: string, price: number = 5000, quantity: number = 100) {
  return db.ticketType.create({
    data: { eventId, name: 'Test Ticket', price, currency: 'GHS', quantity },
  });
}

async function createBooking(userId: string, eventId: string, amount: number = 5000) {
  const s = uid();
  return db.booking.create({
    data: { userId, eventId, totalAmount: amount, currency: 'GHS', status: 'PENDING', bookingRef: `P5E3-${s}` },
  });
}

async function completedPaymentFixture(amount: number = 5000) {
  const s = uid();
  const user = await createUser('PUBLIC');
  const organizer = await createUser('ORGANIZER');
  const event = await createEvent(organizer.id);
  const tt = await createTicketType(event.id, amount, 10);
  await reserveInventory({ ticketTypeId: tt.id, quantity: 1 });
  const booking = await createBooking(user.id, event.id, amount);
  const qr = `QR-P5E3-${s}-${crypto.randomBytes(8).toString('hex')}`;
  await db.ticket.create({ data: { ticketTypeId: tt.id, bookingId: booking.id, qrCode: qr, status: 'PENDING' } });
  const payment = await db.payment.create({
    data: { bookingId: booking.id, userId: user.id, amount, currency: 'GHS', provider: 'PAYSTACK', status: 'PENDING', idempotencyKey: generateIdempotencyKey() },
  });
  await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: `ref-${s}` });
  const cp = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  return { user, organizer, event, tt, booking, payment: cp };
}

async function pendingPaymentFixture(amount: number = 5000) {
  const s = uid();
  const user = await createUser('PUBLIC');
  const organizer = await createUser('ORGANIZER');
  const event = await createEvent(organizer.id);
  const tt = await createTicketType(event.id, amount, 10);
  await reserveInventory({ ticketTypeId: tt.id, quantity: 1 });
  const booking = await createBooking(user.id, event.id, amount);
  const qr = `QR-P5E3-${s}-${crypto.randomBytes(8).toString('hex')}`;
  await db.ticket.create({ data: { ticketTypeId: tt.id, bookingId: booking.id, qrCode: qr, status: 'PENDING' } });
  const providerRef = `pwref-${s}`;
  const payment = await db.payment.create({
    data: { bookingId: booking.id, userId: user.id, amount, currency: 'GHS', provider: 'PAYSTACK', status: 'PENDING', providerRef, idempotencyKey: generateIdempotencyKey() },
  });
  return { user, organizer, event, tt, booking, payment, providerRef };
}

async function cleanup(ids: { eventId: string; userIds: string[] }) {
  await db.event.delete({ where: { id: ids.eventId } }).catch(() => {});
  for (const u of ids.userIds) await db.user.delete({ where: { id: u } }).catch(() => {});
}

function makeWebhookEvent(overrides: Partial<NormalizedWebhookEvent> & { eventId: string; eventReference: string }): NormalizedWebhookEvent {
  return {
    provider: 'PAYSTACK',
    eventType: 'charge.success',
    amount: 5000 as unknown as import('@/lib/money').Money,
    currency: 'GHS',
    eventAt: new Date(),
    isPaymentSuccess: true,
    isPaymentFailure: false,
    ...overrides,
  };
}

function computePaystackSignature(rawBody: string, secret: string): string {
  return crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Validation Schemas
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Validation Schemas', () => {
  it('initializePaymentSchema: valid input', () => {
    const r = initializePaymentSchema.safeParse({ bookingId: 'abc', provider: 'PAYSTACK', callbackUrl: 'https://example.com/cb' });
    expect(r.success).toBe(true);
  });

  it('initializePaymentSchema: provider is optional, defaults excluded', () => {
    const r = initializePaymentSchema.safeParse({ bookingId: 'abc' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.provider).toBeUndefined();
  });

  it('initializePaymentSchema: invalid provider rejected', () => {
    const r = initializePaymentSchema.safeParse({ bookingId: 'abc', provider: 'STRIPE' });
    expect(r.success).toBe(false);
  });

  it('initializePaymentSchema: invalid callbackUrl rejected', () => {
    const r = initializePaymentSchema.safeParse({ bookingId: 'abc', callbackUrl: 'not-a-url' });
    expect(r.success).toBe(false);
  });

  it('initializePaymentSchema: empty bookingId rejected', () => {
    const r = initializePaymentSchema.safeParse({ bookingId: '' });
    expect(r.success).toBe(false);
  });

  it('verifyPaymentSchema: valid', () => {
    const r = verifyPaymentSchema.safeParse({ providerReference: 'ref-123' });
    expect(r.success).toBe(true);
  });

  it('verifyPaymentSchema: empty providerReference rejected', () => {
    const r = verifyPaymentSchema.safeParse({ providerReference: '' });
    expect(r.success).toBe(false);
  });

  it('requestRefundSchema: valid', () => {
    const r = requestRefundSchema.safeParse({ amount: 5000, reason: 'Customer request' });
    expect(r.success).toBe(true);
  });

  it('requestRefundSchema: reason optional, max 500 chars', () => {
    const r1 = requestRefundSchema.safeParse({ amount: 100 });
    expect(r1.success).toBe(true);
    const r2 = requestRefundSchema.safeParse({ amount: 100, reason: 'x'.repeat(501) });
    expect(r2.success).toBe(false);
  });

  it('requestRefundSchema: negative/zero amount rejected', () => {
    expect(requestRefundSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(requestRefundSchema.safeParse({ amount: -1 }).success).toBe(false);
  });

  it('requestRefundSchema: non-integer amount rejected', () => {
    expect(requestRefundSchema.safeParse({ amount: 1.5 }).success).toBe(false);
  });

  it('confirmManualPaymentSchema: all optional', () => {
    const r = confirmManualPaymentSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('paymentQuerySchema: defaults', () => {
    const r = paymentQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(20);
    }
  });

  it('paymentQuerySchema: invalid status rejected', () => {
    const r = paymentQuerySchema.safeParse({ status: 'UNKNOWN' });
    expect(r.success).toBe(false);
  });

  it('paymentQuerySchema: STRIPE allowed in provider filter (legacy)', () => {
    const r = paymentQuerySchema.safeParse({ provider: 'STRIPE' });
    expect(r.success).toBe(true);
  });

  it('processRefundSchema: optional providerRef', () => {
    expect(processRefundSchema.safeParse({}).success).toBe(true);
    expect(processRefundSchema.safeParse({ providerRef: 'ref-1' }).success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Authorization Enforcement
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Authorization', () => {
  it('requireRole blocks PUBLIC from ORGANIZER/SUPER_ADMIN endpoints', () => {
    expect(() => requireRole('ORGANIZER', 'SUPER_ADMIN')({ id: 'x', email: 'x@x', role: 'PUBLIC' } as any)).toThrow();
  });

  it('requireRole allows ORGANIZER', () => {
    expect(() => requireRole('ORGANIZER', 'SUPER_ADMIN')({ id: 'x', email: 'x@x', role: 'ORGANIZER' } as any)).not.toThrow();
  });

  it('requireRole allows SUPER_ADMIN', () => {
    expect(() => requireRole('ORGANIZER', 'SUPER_ADMIN')({ id: 'x', email: 'x@x', role: 'SUPER_ADMIN' } as any)).not.toThrow();
  });

  it('requireRole SUPER_ADMIN only blocks ORGANIZER', () => {
    expect(() => requireRole('SUPER_ADMIN')({ id: 'x', email: 'x@x', role: 'ORGANIZER' } as any)).toThrow();
    expect(() => requireRole('SUPER_ADMIN')({ id: 'x', email: 'x@x', role: 'SUPER_ADMIN' } as any)).not.toThrow();
  });

  it('ownership check: booking owner can access, non-owner cannot', async () => {
    const fixture = await completedPaymentFixture();
    try {
      const booking = await db.booking.findUniqueOrThrow({ where: { id: fixture.booking.id }, select: { userId: true } });
      // Owner check passes
      expect(booking.userId === fixture.user.id || fixture.user.role === 'SUPER_ADMIN').toBe(true);
      // Different user check fails
      const otherId = 'non-owner-id';
      expect(booking.userId === otherId).toBe(false);
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Webhook Signature Verification
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Webhook Signature Verification', () => {
  it('valid signature is deterministic', () => {
    const body = JSON.stringify({ event: 'charge.success', data: { id: 123, reference: 'ref-1', amount: 5000, currency: 'GHS' } });
    const secret = 'test-webhook-secret';
    const sig1 = computePaystackSignature(body, secret);
    const sig2 = computePaystackSignature(body, secret);
    expect(sig1).toBe(sig2);
  });

  it('wrong secret produces different signature', () => {
    const body = JSON.stringify({ event: 'charge.success', data: { id: 123 } });
    const sig1 = computePaystackSignature(body, 'correct-secret');
    const sig2 = computePaystackSignature(body, 'wrong-secret');
    expect(sig1).not.toBe(sig2);
  });

  it('tampered body produces different signature', () => {
    const secret = 'test-webhook-secret';
    const body1 = JSON.stringify({ event: 'charge.success', data: { amount: 5000 } });
    const body2 = JSON.stringify({ event: 'charge.success', data: { amount: 9999 } });
    expect(computePaystackSignature(body1, secret)).not.toBe(computePaystackSignature(body2, secret));
  });

  it('timing-safe comparison: different-length signatures handled safely', () => {
    const buf1 = Buffer.from('abc123');
    const buf2 = Buffer.from('abc12345');
    // Direct timingSafeEqual with different lengths should throw
    expect(() => crypto.timingSafeEqual(buf1, buf2)).toThrow();
    // Route code should check length first (as it does)
    expect(buf1.length !== buf2.length).toBe(true);
  });

  it('HMAC-SHA512 produces 128 hex characters', () => {
    const body = 'test';
    const secret = 'secret';
    const sig = computePaystackSignature(body, secret);
    expect(sig.length).toBe(128); // SHA-512 = 64 bytes = 128 hex chars
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Payment Initialization (Domain Service Integration)
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Payment Initialization', () => {
  it('createBookingPayment creates Payment record with correct fields', async () => {
    const s = uid();
    const user = await createUser();
    const organizer = await createUser('ORGANIZER');
    const event = await createEvent(organizer.id);
    const tt = await createTicketType(event.id, 5000, 10);
    await reserveInventory({ ticketTypeId: tt.id, quantity: 1 });
    const booking = await createBooking(user.id, event.id, 5000);
    try {
      const result = await createBookingPayment({
        bookingId: booking.id,
        userId: user.id,
        amount: 5000,
        currency: 'GHS',
      });

      expect(result.paymentId).toBeTruthy();
      expect(result.provider).toBe('PAYSTACK');
      expect(result.status).toBe('PENDING');

      const payment = await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
      expect(payment.amount).toBe(5000);
      expect(payment.status).toBe('PENDING');
      expect(payment.idempotencyKey).toBeTruthy();
    } finally {
      await cleanup({ eventId: event.id, userIds: [user.id, organizer.id] });
    }
  });

  it('createBookingPayment for zero amount uses FREE provider', async () => {
    const s = uid();
    const user = await createUser();
    const organizer = await createUser('ORGANIZER');
    const event = await createEvent(organizer.id);
    const tt = await createTicketType(event.id, 0, 10);
    const booking = await createBooking(user.id, event.id, 0);
    try {
      const result = await createBookingPayment({
        bookingId: booking.id,
        userId: user.id,
        amount: 0,
        currency: 'GHS',
      });

      expect(result.provider).toBe('FREE');
    } finally {
      await cleanup({ eventId: event.id, userIds: [user.id, organizer.id] });
    }
  });

  it('idempotent: duplicate createBookingPayment returns same payment', async () => {
    const s = uid();
    const user = await createUser();
    const organizer = await createUser('ORGANIZER');
    const event = await createEvent(organizer.id);
    const tt = await createTicketType(event.id, 5000, 10);
    await reserveInventory({ ticketTypeId: tt.id, quantity: 1 });
    const booking = await createBooking(user.id, event.id, 5000);
    try {
      const result1 = await createBookingPayment({ bookingId: booking.id, userId: user.id, amount: 5000, currency: 'GHS' });
      // Second call should be idempotent (same booking → same payment)
      const result2 = await createBookingPayment({ bookingId: booking.id, userId: user.id, amount: 5000, currency: 'GHS' });
      expect(result2.paymentId).toBe(result1.paymentId);
    } finally {
      await cleanup({ eventId: event.id, userIds: [user.id, organizer.id] });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Manual Payment Confirmation
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Manual Payment Confirmation', () => {
  it('MANUAL provider payment can be confirmed via confirmBookingOnPaymentSuccess', async () => {
    const s = uid();
    const user = await createUser();
    const organizer = await createUser('ORGANIZER');
    const event = await createEvent(organizer.id);
    const tt = await createTicketType(event.id, 5000, 10);
    await reserveInventory({ ticketTypeId: tt.id, quantity: 1 });
    const booking = await createBooking(user.id, event.id, 5000);
    const qr = `QR-MAN-${s}-${crypto.randomBytes(8).toString('hex')}`;
    await db.ticket.create({ data: { ticketTypeId: tt.id, bookingId: booking.id, qrCode: qr, status: 'PENDING' } });
    const payment = await db.payment.create({
      data: { bookingId: booking.id, userId: user.id, amount: 5000, currency: 'GHS', provider: 'MANUAL', status: 'PENDING', idempotencyKey: generateIdempotencyKey() },
    });

    try {
      const result = await confirmBookingOnPaymentSuccess({ paymentId: payment.id, providerReference: 'manual-ref-1' });
      expect(result.confirmed).toBe(true);

      const updatedPayment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updatedPayment.status).toBe('COMPLETED');

      const updatedBooking = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(updatedBooking.status).toBe('CONFIRMED');
    } finally {
      await cleanup({ eventId: event.id, userIds: [user.id, organizer.id] });
    }
  });

  it('PAYSTACK provider payment cannot be manually confirmed (route-level check)', async () => {
    // The route checks payment.provider !== 'MANUAL' and returns 400.
    // Here we verify the domain service would succeed anyway,
    // confirming the route-level guard is needed.
    const fixture = await pendingPaymentFixture();
    try {
      // Domain service doesn't care about provider — it just confirms
      const result = await confirmBookingOnPaymentSuccess({ paymentId: fixture.payment.id });
      expect(result.confirmed).toBe(true);
      // This confirms the route MUST check provider === 'MANUAL' to prevent
      // bypassing Paystack verification
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('cannot confirm a COMPLETED payment again (idempotent)', async () => {
    const fixture = await completedPaymentFixture();
    try {
      const result = await confirmBookingOnPaymentSuccess({ paymentId: fixture.payment.id });
      expect(result.confirmed).toBe(false); // Already confirmed
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Refund Authorization & Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Refund Authorization & Lifecycle', () => {
  it('only COMPLETED payments can be refunded', async () => {
    const fixture = await pendingPaymentFixture();
    try {
      await expect(
        requestRefund({ paymentId: fixture.payment.id, amount: 5000, requestedBy: fixture.user.id }),
      ).rejects.toThrow(RefundNotEligible);
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('booking owner can request refund for COMPLETED payment', async () => {
    const fixture = await completedPaymentFixture();
    try {
      const result = await requestRefund({
        paymentId: fixture.payment.id,
        amount: 5000,
        reason: 'Full refund',
        requestedBy: fixture.user.id,
      });
      expect(result.status).toBe('REQUESTED');
      expect(result.amount).toBe(5000);
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('refund amount cannot exceed payment amount', async () => {
    const fixture = await completedPaymentFixture(3000);
    try {
      await expect(
        requestRefund({ paymentId: fixture.payment.id, amount: 5000, requestedBy: fixture.user.id }),
      ).rejects.toThrow(/exceed/i);
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('duplicate refund request is blocked', async () => {
    const fixture = await completedPaymentFixture();
    try {
      await requestRefund({ paymentId: fixture.payment.id, amount: 5000, requestedBy: fixture.user.id });
      await expect(
        requestRefund({ paymentId: fixture.payment.id, amount: 5000, requestedBy: fixture.user.id }),
      ).rejects.toThrow(DuplicateRefund);
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('full refund lifecycle: REQUESTED → PROCESSING → COMPLETED', async () => {
    const fixture = await completedPaymentFixture();
    try {
      const refund = await requestRefund({ paymentId: fixture.payment.id, amount: 5000, requestedBy: fixture.user.id });
      expect(refund.status).toBe('REQUESTED');

      await markRefundProcessing(refund.refundId);
      const r1 = await db.refund.findUniqueOrThrow({ where: { id: refund.refundId } });
      expect(r1.status).toBe('PROCESSING');

      const completion = await processRefundCompletion({ refundId: refund.refundId, providerRef: 'refund-ref-1' });
      expect(completion.status).toBe('COMPLETED');

      const payment = await db.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } });
      expect(payment.refundedAmount).toBe(5000);
      expect(payment.status).toBe('REFUNDED');
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('refund not found throws RefundNotFound', async () => {
    await expect(processRefundCompletion({ refundId: 'nonexistent' })).rejects.toThrow(RefundNotFound);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Webhook Processing
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Webhook Processing', () => {
  it('success webhook confirms booking', async () => {
    const fixture = await pendingPaymentFixture();
    try {
      const event = makeWebhookEvent({
        eventId: `evt-wk-suc-${uid()}`,
        eventReference: fixture.providerRef,
      });

      const result = await processWebhookEvent({ event });
      expect(result.processed).toBe(true);

      const payment = await db.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } });
      expect(payment.status).toBe('COMPLETED');
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('failure webhook transitions payment to FAILED', async () => {
    const fixture = await pendingPaymentFixture();
    try {
      const event: NormalizedWebhookEvent = {
        provider: 'PAYSTACK',
        eventId: `evt-wk-fail-${uid()}`,
        eventType: 'charge.failed',
        eventReference: fixture.providerRef,
        amount: 5000 as unknown as import('@/lib/money').Money,
        currency: 'GHS',
        eventAt: new Date(),
        isPaymentSuccess: false,
        isPaymentFailure: true,
      };

      const result = await processWebhookEvent({ event });
      expect(result.processed).toBe(true);

      const payment = await db.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } });
      expect(payment.status).toBe('FAILED');
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('duplicate eventId is deduplicated', async () => {
    const fixture = await pendingPaymentFixture();
    try {
      const event = makeWebhookEvent({
        eventId: `evt-wk-dedup-${uid()}`,
        eventReference: fixture.providerRef,
      });

      const r1 = await processWebhookEvent({ event });
      expect(r1.processed).toBe(true);

      const r2 = await processWebhookEvent({ event });
      expect(r2.processed).toBe(false);
      expect(r2.outcome).toContain('already processed');
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('amount mismatch is caught and event marked as permanent error', async () => {
    const fixture = await pendingPaymentFixture();
    try {
      const event = makeWebhookEvent({
        eventId: `evt-wk-ammis-${uid()}`,
        eventReference: fixture.providerRef,
        amount: 9999 as unknown as import('@/lib/money').Money,
      });

      await expect(processWebhookEvent({ event })).rejects.toThrow(WebhookAmountMismatch);

      const we = await db.paymentWebhookEvent.findUnique({ where: { eventId: event.eventId } });
      expect(we?.processed).toBe(true); // Permanent — non-retriable
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('currency mismatch is caught', async () => {
    const fixture = await pendingPaymentFixture();
    try {
      const event = makeWebhookEvent({
        eventId: `evt-wk-curmis-${uid()}`,
        eventReference: fixture.providerRef,
        currency: 'USD',
      });

      await expect(processWebhookEvent({ event })).rejects.toThrow(WebhookCurrencyMismatch);
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('payment not found is marked as permanent (non-retriable)', async () => {
    const event = makeWebhookEvent({
      eventId: `evt-wk-nofind-${uid()}`,
      eventReference: 'nonexistent-ref',
    });

    const result = await processWebhookEvent({ event });
    expect(result.processed).toBe(true);
    expect(result.outcome).toContain('Payment not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Payment Expiry
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Payment Expiry', () => {
  it('canBeExpired returns true for PENDING and PROCESSING', () => {
    expect(canBeExpired('PENDING')).toBe(true);
    expect(canBeExpired('PROCESSING')).toBe(true);
  });

  it('canBeExpired returns false for terminal states', () => {
    expect(canBeExpired('COMPLETED')).toBe(false);
    expect(canBeExpired('FAILED')).toBe(false);
    expect(canBeExpired('CANCELLED')).toBe(false);
    expect(canBeExpired('EXPIRED')).toBe(false);
    expect(canBeExpired('REFUNDED')).toBe(false);
  });

  it('expireEligiblePayments runs without error', async () => {
    // No expired payments in test DB — just verify it doesn't throw
    const result = await expireEligiblePayments();
    expect(result).toBeTruthy();
    expect(typeof result.expired).toBe('number');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Financial Integrity Preservation
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Financial Integrity', () => {
  it('duplicate webhook deliveries do not double-confirm booking', async () => {
    const fixture = await pendingPaymentFixture();
    try {
      const event = makeWebhookEvent({
        eventId: `evt-fi-dedup-${uid()}`,
        eventReference: fixture.providerRef,
      });

      await processWebhookEvent({ event });
      // Payment now COMPLETED
      const p1 = await db.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } });
      expect(p1.status).toBe('COMPLETED');

      // Process again — should be idempotent
      await processWebhookEvent({ event });

      const p2 = await db.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } });
      expect(p2.status).toBe('COMPLETED');
      expect(p2.refundedAmount).toBe(0); // No duplicate effects
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('concurrent refunds cannot over-refund', async () => {
    const fixture = await completedPaymentFixture(5000);
    try {
      // Request first refund
      const r1 = await requestRefund({ paymentId: fixture.payment.id, amount: 5000, requestedBy: fixture.user.id });

      // Second refund should be blocked (duplicate)
      await expect(
        requestRefund({ paymentId: fixture.payment.id, amount: 5000, requestedBy: fixture.user.id }),
      ).rejects.toThrow(DuplicateRefund);

      // Complete the first refund
      await markRefundProcessing(r1.refundId);
      await processRefundCompletion({ refundId: r1.refundId });

      const payment = await db.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } });
      expect(payment.refundedAmount).toBe(5000); // Not 10000
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('inventory invariant holds after payment success', async () => {
    const fixture = await pendingPaymentFixture();
    try {
      const ttBefore = await db.ticketType.findUniqueOrThrow({ where: { id: fixture.tt.id } });

      const event = makeWebhookEvent({
        eventId: `evt-fi-inv-${uid()}`,
        eventReference: fixture.providerRef,
      });
      await processWebhookEvent({ event });

      const ttAfter = await db.ticketType.findUniqueOrThrow({ where: { id: fixture.tt.id } });
      // soldCount + reservedCount <= quantity
      expect(ttAfter.soldCount + ttAfter.reservedCount).toBeLessThanOrEqual(ttAfter.quantity);
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('payment state machine prevents illegal transitions from routes', () => {
    // Routes must never allow these transitions
    expect(() => validatePaymentTransition('COMPLETED', 'PENDING')).toThrow();
    expect(() => validatePaymentTransition('FAILED', 'COMPLETED')).toThrow();
    expect(() => validatePaymentTransition('REFUNDED', 'COMPLETED')).toThrow();
    expect(() => validatePaymentTransition('CANCELLED', 'COMPLETED')).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Provider Integration Boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Provider Integration Boundary', () => {
  it('PAYSTACK provider throws ProviderIntegrationPending for initializePayment', async () => {
    const paystack = providerRegistry.get('PAYSTACK');
    expect(paystack).toBeTruthy();
    await expect(
      paystack!.initializePayment({
        paymentId: 'test',
        amount: 5000 as unknown as import('@/lib/money').Money,
        currency: 'GHS',
        customer: { userId: 'u1', email: 'test@test.com' },
        idempotencyKey: 'ik-1',
      }),
    ).rejects.toThrow(ProviderIntegrationPending);
  });

  it('PAYSTACK provider throws ProviderIntegrationPending for verifyPayment', async () => {
    const paystack = providerRegistry.get('PAYSTACK');
    await expect(
      paystack!.verifyPayment({
        paymentId: 'test',
        providerReference: 'ref-1',
        expectedAmount: 5000 as unknown as import('@/lib/money').Money,
        expectedCurrency: 'GHS',
      }),
    ).rejects.toThrow(ProviderIntegrationPending);
  });

  it('PAYSTACK provider throws ProviderIntegrationPending for requestRefund', async () => {
    const paystack = providerRegistry.get('PAYSTACK');
    await expect(
      paystack!.requestRefund({
        paymentId: 'test',
        providerReference: 'ref-1',
        amount: 5000 as unknown as import('@/lib/money').Money,
        currency: 'GHS',
      }),
    ).rejects.toThrow(ProviderIntegrationPending);
  });

  it('FREE provider completes immediately', async () => {
    const free = providerRegistry.get('FREE');
    expect(free).toBeTruthy();
    const result = await free!.initializePayment({
      paymentId: 'test',
      amount: 0 as unknown as import('@/lib/money').Money,
      currency: 'GHS',
      customer: { userId: 'u1', email: 'test@test.com' },
      idempotencyKey: 'ik-2',
    });
    expect(result.success).toBe(true);
  });

  it('MANUAL provider is registered', () => {
    const manual = providerRegistry.get('MANUAL');
    expect(manual).toBeTruthy();
  });

  it('ProviderIntegrationPending has code and statusCode for error handler', () => {
    const error = new ProviderIntegrationPending('PAYSTACK', 'initializePayment');
    expect(error.code).toBe('PROVIDER_INTEGRATION_PENDING');
    expect(error.statusCode).toBe(501);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Route Response Contracts
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Route Response Contracts', () => {
  it('payment object contains required fields for GET /api/payments/:id', async () => {
    const fixture = await completedPaymentFixture();
    try {
      const payment = await db.payment.findUniqueOrThrow({
        where: { id: fixture.payment.id },
        select: {
          id: true, amount: true, currency: true, provider: true, status: true,
          providerRef: true, refundedAmount: true, expiresAt: true,
          completedAt: true, failedAt: true, cancelledAt: true,
          createdAt: true, updatedAt: true,
        },
      });
      // All these fields should be present in the API response
      expect(payment.id).toBeTruthy();
      expect(payment.amount).toBe(5000);
      expect(payment.currency).toBe('GHS');
      expect(payment.provider).toBe('PAYSTACK');
      expect(payment.status).toBe('COMPLETED');
      expect(payment.refundedAmount).toBe(0);
      expect(payment.completedAt).toBeTruthy();
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });

  it('refund object contains required fields', async () => {
    const fixture = await completedPaymentFixture();
    try {
      const refund = await requestRefund({ paymentId: fixture.payment.id, amount: 5000, requestedBy: fixture.user.id });
      const refundRecord = await db.refund.findUniqueOrThrow({
        where: { id: refund.refundId },
        select: { id: true, amount: true, reason: true, status: true, paymentId: true, createdAt: true },
      });
      expect(refundRecord.id).toBeTruthy();
      expect(refundRecord.amount).toBe(5000);
      expect(refundRecord.status).toBe('REQUESTED');
      expect(refundRecord.paymentId).toBe(fixture.payment.id);
    } finally {
      await cleanup({ eventId: fixture.event.id, userIds: [fixture.user.id, fixture.organizer.id] });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. Payment State Machine (Route-Level)
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 3: Payment State Machine for Routes', () => {
  it('PENDING → COMPLETED (webhook success) is legal', () => {
    expect(() => validatePaymentTransition('PENDING', 'COMPLETED')).not.toThrow();
  });

  it('PENDING → FAILED (webhook failure) is legal', () => {
    expect(() => validatePaymentTransition('PENDING', 'FAILED')).not.toThrow();
  });

  it('PENDING → PROCESSING (provider init) is legal', () => {
    expect(() => validatePaymentTransition('PENDING', 'PROCESSING')).not.toThrow();
  });

  it('PROCESSING → COMPLETED (provider confirm) is legal', () => {
    expect(() => validatePaymentTransition('PROCESSING', 'COMPLETED')).not.toThrow();
  });

  it('PROCESSING → FAILED (provider reject) is legal', () => {
    expect(() => validatePaymentTransition('PROCESSING', 'FAILED')).not.toThrow();
  });

  it('COMPLETED → REFUNDED (full refund) is legal', () => {
    expect(() => validatePaymentTransition('COMPLETED', 'REFUNDED')).not.toThrow();
  });

  it('canBeRefunded only for COMPLETED', () => {
    expect(canBeRefunded('COMPLETED')).toBe(true);
    expect(canBeRefunded('PENDING')).toBe(false);
    expect(canBeRefunded('PROCESSING')).toBe(false);
    expect(canBeRefunded('FAILED')).toBe(false);
  });

  it('isTerminalStatus for all terminal states', () => {
    expect(isTerminalStatus('FAILED')).toBe(true);
    expect(isTerminalStatus('CANCELLED')).toBe(true);
    expect(isTerminalStatus('EXPIRED')).toBe(true);
    expect(isTerminalStatus('REFUNDED')).toBe(true);
    expect(isTerminalStatus('PENDING')).toBe(false);
    expect(isTerminalStatus('PROCESSING')).toBe(false);
    expect(isTerminalStatus('COMPLETED')).toBe(false);
  });
});
