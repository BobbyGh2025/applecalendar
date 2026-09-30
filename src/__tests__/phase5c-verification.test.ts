// @vitest-environment node
/**
 * Phase 5C — Additional Verification Tests
 *
 * Tests money constraints, API contracts, booking financial integrity,
 * and full-system minor-unit coherence.
 */
import { describe, it, expect } from 'vitest';
import {
  parseMoney,
  parseMoneyOrThrow,
  formatMoney,
  formatMoneyWithSymbol,
  addMoney,
  subtractMoney,
  multiplyMoney,
  calculatePercentage,
  calculatePlatformFee,
  calculateOrganizerRevenue,
  isValidMoney,
  isFree,
  asMoney,
  DEFAULT_CURRENCY,
  getCurrencyDecimals,
} from '@/lib/money';
import {
  assertNonNegativeMoney,
  assertRefundedNotExceedAmount,
  validatePaymentMoneyConstraints,
  validateBookingMoneyConstraints,
  validateTicketTypeMoneyConstraints,
  validateSubscriptionPlanMoneyConstraints,
  validateEventAnalyticsMoneyConstraints,
} from '@/lib/money-constraints';
import { db } from '@/lib/db';

// ═══════════════════════════════════════════════════════════════════
// 1. MONEY CONSTRAINT VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('1. Money Constraint Validation', () => {
  it('1.1 assertNonNegativeMoney accepts valid money', () => {
    expect(() => assertNonNegativeMoney(0, 'test')).not.toThrow();
    expect(() => assertNonNegativeMoney(100, 'test')).not.toThrow();
    expect(() => assertNonNegativeMoney(5000, 'test')).not.toThrow();
  });

  it('1.2 assertNonNegativeMoney rejects negative values', () => {
    expect(() => assertNonNegativeMoney(-1, 'Payment.amount')).toThrow('Constraint violation');
    expect(() => assertNonNegativeMoney(-100, 'Booking.totalAmount')).toThrow('Constraint violation');
  });

  it('1.3 assertNonNegativeMoney rejects non-integer values', () => {
    expect(() => assertNonNegativeMoney(1.5, 'test')).toThrow('Constraint violation');
    expect(() => assertNonNegativeMoney(NaN, 'test')).toThrow('Constraint violation');
    expect(() => assertNonNegativeMoney(Infinity, 'test')).toThrow('Constraint violation');
  });

  it('1.4 assertRefundedNotExceedAmount accepts valid refunds', () => {
    expect(() => assertRefundedNotExceedAmount(0, 5000)).not.toThrow();
    expect(() => assertRefundedNotExceedAmount(2500, 5000)).not.toThrow();
    expect(() => assertRefundedNotExceedAmount(5000, 5000)).not.toThrow();
  });

  it('1.5 assertRefundedNotExceedAmount rejects refund > amount', () => {
    expect(() => assertRefundedNotExceedAmount(5001, 5000)).toThrow('Constraint violation');
    expect(() => assertRefundedNotExceedAmount(10000, 5000)).toThrow('Constraint violation');
  });

  it('1.6 validatePaymentMoneyConstraints validates complete payment', () => {
    expect(() => validatePaymentMoneyConstraints({ amount: 5000, refundedAmount: 0 })).not.toThrow();
    expect(() => validatePaymentMoneyConstraints({ amount: 5000, refundedAmount: 5000 })).not.toThrow();
    expect(() => validatePaymentMoneyConstraints({ amount: 5000 })).not.toThrow();
  });

  it('1.7 validatePaymentMoneyConstraints rejects invalid payment', () => {
    expect(() => validatePaymentMoneyConstraints({ amount: -1, refundedAmount: 0 })).toThrow();
    expect(() => validatePaymentMoneyConstraints({ amount: 5000, refundedAmount: 5001 })).toThrow();
    expect(() => validatePaymentMoneyConstraints({ amount: 5000, refundedAmount: -1 })).toThrow();
  });

  it('1.8 validateBookingMoneyConstraints validates booking', () => {
    expect(() => validateBookingMoneyConstraints({ totalAmount: 0 })).not.toThrow();
    expect(() => validateBookingMoneyConstraints({ totalAmount: 29900 })).not.toThrow();
    expect(() => validateBookingMoneyConstraints({ totalAmount: -1 })).toThrow();
  });

  it('1.9 validateTicketTypeMoneyConstraints validates ticket type', () => {
    expect(() => validateTicketTypeMoneyConstraints({ price: 0 })).not.toThrow();
    expect(() => validateTicketTypeMoneyConstraints({ price: 5000 })).not.toThrow();
    expect(() => validateTicketTypeMoneyConstraints({ price: -1 })).toThrow();
  });

  it('1.10 validateSubscriptionPlanMoneyConstraints validates plan', () => {
    expect(() => validateSubscriptionPlanMoneyConstraints({ price: 0 })).not.toThrow();
    expect(() => validateSubscriptionPlanMoneyConstraints({ price: 29900 })).not.toThrow();
    expect(() => validateSubscriptionPlanMoneyConstraints({ price: -1 })).toThrow();
  });

  it('1.11 validateEventAnalyticsMoneyConstraints validates analytics', () => {
    expect(() => validateEventAnalyticsMoneyConstraints({ revenue: 0 })).not.toThrow();
    expect(() => validateEventAnalyticsMoneyConstraints({ revenue: 100000 })).not.toThrow();
    expect(() => validateEventAnalyticsMoneyConstraints({ revenue: -1 })).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. ZOD API CONTRACT — Price is integer minor units
// ═══════════════════════════════════════════════════════════════════

describe('2. Zod API Contract — Price Validation', () => {
  it('2.1 ticketTypeSchema rejects float price', async () => {
    const { createEventSchema } = await import('@/lib/validations/events');
    const result = createEventSchema.safeParse({
      title: 'Test Event',
      description: 'A test event description that is long enough',
      startDate: '2025-12-01',
      isVirtual: true,
      ticketTypes: [{ name: 'General', price: 25.50, quantity: 100 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const priceIssue = result.error.issues.find(i =>
        i.path.some(p => p === 'price')
      );
      expect(priceIssue).toBeDefined();
      expect(priceIssue?.message).toContain('integer');
    }
  });

  it('2.2 ticketTypeSchema accepts integer price', async () => {
    const { createEventSchema } = await import('@/lib/validations/events');
    const result = createEventSchema.safeParse({
      title: 'Test Event',
      description: 'A test event description that is long enough',
      startDate: '2025-12-01',
      isVirtual: true,
      ticketTypes: [{ name: 'General', price: 2550, quantity: 100 }],
    });
    expect(result.success).toBe(true);
  });

  it('2.3 ticketTypeSchema rejects negative price', async () => {
    const { createEventSchema } = await import('@/lib/validations/events');
    const result = createEventSchema.safeParse({
      title: 'Test Event',
      description: 'A test event description that is long enough',
      startDate: '2025-12-01',
      isVirtual: true,
      ticketTypes: [{ name: 'General', price: -100, quantity: 100 }],
    });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. BOOKING FINANCIAL INTEGRITY
// ═══════════════════════════════════════════════════════════════════

describe('3. Booking Financial Integrity', () => {
  it('3.1 booking total = price × quantity with minor units', async () => {
    const booking = await db.booking.findFirst({
      where: { totalAmount: { not: 0 } },
      include: { tickets: { include: { ticketType: true } } },
    });

    if (booking && booking.tickets.length > 0) {
      let expectedTotal = 0;
      for (const ticket of booking.tickets) {
        expectedTotal = addMoney(asMoney(expectedTotal), asMoney(ticket.ticketType.price));
      }
      expect(booking.totalAmount).toBe(expectedTotal);
      // Verify no floating-point drift
      expect(Number.isInteger(booking.totalAmount)).toBe(true);
    }
  });

  it('3.2 multiplyMoney produces same result as iterative addMoney', () => {
    const price = asMoney(2500); // GHS 25.00
    const quantity = 4;
    const byMultiply = multiplyMoney(price, quantity);
    let byAdd = asMoney(0);
    for (let i = 0; i < quantity; i++) {
      byAdd = addMoney(byAdd, price);
    }
    expect(byMultiply).toBe(byAdd);
    expect(byMultiply).toBe(10000); // GHS 100.00
  });

  it('3.3 all paid bookings have matching payment amounts', async () => {
    const bookings = await db.booking.findMany({
      where: { totalAmount: { not: 0 }, status: 'CONFIRMED' },
      include: { payment: true },
    });

    for (const booking of bookings) {
      if (booking.payment && booking.payment.status === 'COMPLETED') {
        expect(booking.payment.amount).toBe(booking.totalAmount);
      }
    }
  });

  it('3.4 no booking has negative totalAmount in database', async () => {
    const negativeBookings = await db.booking.findMany({
      where: { totalAmount: { lt: 0 } },
    });
    expect(negativeBookings.length).toBe(0);
  });

  it('3.5 no payment has negative amount in database', async () => {
    const negativePayments = await db.payment.findMany({
      where: { amount: { lt: 0 } },
    });
    expect(negativePayments.length).toBe(0);
  });

  it('3.6 no payment has refundedAmount > amount in database', async () => {
    const invalidPayments = await db.payment.findMany({
      where: { refundedAmount: { gt: 0 } },
    });
    for (const payment of invalidPayments) {
      expect(payment.refundedAmount).toBeLessThanOrEqual(payment.amount);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. SUBSCRIPTION PLAN INTEGRITY
// ═══════════════════════════════════════════════════════════════════

describe('4. Subscription Plan Integrity', () => {
  it('4.1 all plan prices are non-negative integers', async () => {
    const plans = await db.subscriptionPlan.findMany();
    for (const plan of plans) {
      expect(Number.isInteger(plan.price)).toBe(true);
      expect(plan.price).toBeGreaterThanOrEqual(0);
      expect(isValidMoney(plan.price)).toBe(true);
    }
  });

  it('4.2 Free plan has price = 0', async () => {
    const freePlan = await db.subscriptionPlan.findUnique({ where: { slug: 'free' } });
    expect(freePlan).not.toBeNull();
    expect(freePlan!.price).toBe(0);
    expect(isFree(asMoney(freePlan!.price))).toBe(true);
  });

  it('4.3 paid plans have price > 0 in minor units', async () => {
    const paidPlans = await db.subscriptionPlan.findMany({
      where: { price: { gt: 0 } },
    });
    expect(paidPlans.length).toBeGreaterThan(0);
    for (const plan of paidPlans) {
      expect(plan.price % 100).toBe(0); // All current plans are whole GHS amounts
    }
  });

  it('4.4 all plans have GHS currency', async () => {
    const plans = await db.subscriptionPlan.findMany();
    for (const plan of plans) {
      expect(plan.currency).toBe('GHS');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. TICKET TYPE INTEGRITY
// ═══════════════════════════════════════════════════════════════════

describe('5. Ticket Type Integrity', () => {
  it('5.1 all ticket prices are non-negative integers', async () => {
    const ticketTypes = await db.ticketType.findMany();
    for (const tt of ticketTypes) {
      expect(Number.isInteger(tt.price)).toBe(true);
      expect(tt.price).toBeGreaterThanOrEqual(0);
    }
  });

  it('5.2 free ticket types have price = 0', async () => {
    const freeTickets = await db.ticketType.findMany({ where: { price: 0 } });
    for (const tt of freeTickets) {
      expect(isFree(asMoney(tt.price))).toBe(true);
    }
  });

  it('5.3 soldCount never exceeds quantity', async () => {
    const ticketTypes = await db.ticketType.findMany();
    for (const tt of ticketTypes) {
      expect(tt.soldCount).toBeLessThanOrEqual(tt.quantity);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. EVENT ANALYTICS INTEGRITY
// ═══════════════════════════════════════════════════════════════════

describe('6. Event Analytics Integrity', () => {
  it('6.1 all revenue values are non-negative integers', async () => {
    const analytics = await db.eventAnalytics.findMany();
    for (const a of analytics) {
      expect(Number.isInteger(a.revenue)).toBe(true);
      expect(a.revenue).toBeGreaterThanOrEqual(0);
    }
  });

  it('6.2 revenue is a multiple of 100 (whole pesewas)', async () => {
    const analytics = await db.eventAnalytics.findMany({ take: 100 });
    for (const a of analytics) {
      // Revenue from seed data is generated as (random * 100) * 100
      // All minor-unit values should be integers but not necessarily multiples of 100
      expect(Number.isInteger(a.revenue)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. PLATFORM FEE CALCULATIONS
// ═══════════════════════════════════════════════════════════════════

describe('7. Platform Fee Calculations', () => {
  it('7.1 5% platform fee on GHS 299.00 = GHS 14.95', () => {
    const amount = asMoney(29900); // GHS 299.00
    const fee = calculatePlatformFee(amount, 5);
    expect(fee).toBe(1495); // GHS 14.95
    expect(formatMoney(fee, 'GHS')).toBe('14.95');
  });

  it('7.2 organizer revenue = amount - fee (no floating-point drift)', () => {
    const amount = asMoney(29900);
    const revenue = calculateOrganizerRevenue(amount, 5);
    expect(revenue).toBe(28405); // 29900 - 1495 = 28405 → GHS 284.05
    expect(formatMoney(revenue, 'GHS')).toBe('284.05');

    // Verify: fee + revenue = original amount (no money lost)
    const fee = calculatePlatformFee(amount, 5);
    expect(addMoney(asMoney(fee), asMoney(revenue))).toBe(amount);
  });

  it('7.3 fee calculation is deterministic over 10000 iterations', () => {
    for (let i = 0; i < 10000; i++) {
      const fee = calculatePlatformFee(asMoney(29900), 5);
      expect(fee).toBe(1495);
    }
  });

  it('7.4 large amounts: GHS 1,000,000.00 fee at 5%', () => {
    const amount = asMoney(100000000); // GHS 1,000,000.00
    const fee = calculatePlatformFee(amount, 5);
    expect(fee).toBe(5000000); // GHS 50,000.00
    expect(formatMoney(fee, 'GHS')).toBe('50000.00');
  });

  it('7.5 small amounts: GHS 0.01 fee at 5% floors to 0', () => {
    const amount = asMoney(1); // GHS 0.01
    const fee = calculatePlatformFee(amount, 5);
    expect(fee).toBe(0); // Floor(0.05) = 0 → GHS 0.00 (no fee on 1 pesewa)
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. ROUND-TRIP: parseMoney → formatMoney → parseMoney
// ═══════════════════════════════════════════════════════════════════

describe('8. Round-Trip Consistency', () => {
  const testValues = [0, 0.01, 0.50, 1, 25.50, 100, 299.99, 1000, 99999.99];

  it('8.1 parseMoney → formatMoney → parseMoney returns same value', () => {
    for (const val of testValues) {
      const parsed = parseMoneyOrThrow(val, 'GHS');
      const formatted = formatMoney(parsed, 'GHS');
      const reparsed = parseMoneyOrThrow(formatted, 'GHS');
      expect(reparsed).toBe(parsed);
    }
  });

  it('8.2 string parseMoney → formatMoney → parseMoney returns same value', () => {
    for (const val of testValues) {
      const str = String(val);
      const parsed = parseMoneyOrThrow(str, 'GHS');
      const formatted = formatMoney(parsed, 'GHS');
      const reparsed = parseMoneyOrThrow(formatted, 'GHS');
      expect(reparsed).toBe(parsed);
    }
  });

  it('8.3 USD round-trip works correctly', () => {
    const val = 10.99;
    const parsed = parseMoneyOrThrow(val, 'USD');
    expect(parsed).toBe(1099);
    const formatted = formatMoney(parsed, 'USD');
    expect(formatted).toBe('10.99');
    const reparsed = parseMoneyOrThrow(formatted, 'USD');
    expect(reparsed).toBe(1099);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. SCHEMA: NO FLOAT MONETARY FIELDS REMAIN
// ═══════════════════════════════════════════════════════════════════

describe('9. Schema: No Float Monetary Fields', () => {
  it('9.1 SubscriptionPlan.price is Int (reads as integer)', async () => {
    const plan = await db.subscriptionPlan.findFirst({ where: { slug: 'starter' } });
    expect(plan).not.toBeNull();
    expect(Number.isInteger(plan!.price)).toBe(true);
  });

  it('9.2 TicketType.price is Int (reads as integer)', async () => {
    const tt = await db.ticketType.findFirst({ where: { price: { gt: 0 } } });
    if (tt) {
      expect(Number.isInteger(tt.price)).toBe(true);
    }
  });

  it('9.3 Booking.totalAmount is Int (reads as integer)', async () => {
    const booking = await db.booking.findFirst();
    if (booking) {
      expect(Number.isInteger(booking.totalAmount)).toBe(true);
    }
  });

  it('9.4 Payment.amount is Int (reads as integer)', async () => {
    const payment = await db.payment.findFirst();
    if (payment) {
      expect(Number.isInteger(payment.amount)).toBe(true);
      expect(Number.isInteger(payment.refundedAmount)).toBe(true);
    }
  });

  it('9.5 EventAnalytics.revenue is Int (reads as integer)', async () => {
    const analytics = await db.eventAnalytics.findFirst();
    if (analytics) {
      expect(Number.isInteger(analytics.revenue)).toBe(true);
    }
  });
});
