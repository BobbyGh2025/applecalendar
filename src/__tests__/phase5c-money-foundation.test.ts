// @vitest-environment node
/**
 * Phase 5C — Database & Financial Data Foundation Tests
 *
 * Tests the money utilities, precision guarantees, API contracts,
 * and schema correctness for the integer minor-unit monetary system.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  parseMoney,
  parseMoneyOrThrow,
  formatMoney,
  formatMoneyWithSymbol,
  getCurrencySymbol,
  getCurrencyDecimals,
  getMinorUnitMultiplier,
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
} from '@/lib/money';
import { db } from '@/lib/db';

// ═══════════════════════════════════════════════════════════════════
// 1. MONEY PARSING
// ═══════════════════════════════════════════════════════════════════

describe('1. Money Parsing', () => {
  it('1.1 parses GHS 50.00 → 5000', () => {
    const result = parseMoney(50.0, 'GHS');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(5000);
  });

  it('1.2 parses GHS 50.50 → 5050', () => {
    const result = parseMoney(50.5, 'GHS');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(5050);
  });

  it('1.3 parses 0 → 0', () => {
    const result = parseMoney(0, 'GHS');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(0);
  });

  it('1.4 parses 0.01 → 1', () => {
    const result = parseMoney(0.01, 'GHS');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(1);
  });

  it('1.5 parses string "25.99" → 2599', () => {
    const result = parseMoney('25.99', 'USD');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(2599);
  });

  it('1.6 rejects negative values', () => {
    expect(parseMoney(-5, 'GHS').success).toBe(false);
    expect(parseMoney('-10', 'GHS').success).toBe(false);
  });

  it('1.7 rejects NaN and Infinity', () => {
    expect(parseMoney(NaN, 'GHS').success).toBe(false);
    expect(parseMoney(Infinity, 'GHS').success).toBe(false);
    expect(parseMoney(-Infinity, 'GHS').success).toBe(false);
  });

  it('1.8 rejects null/undefined', () => {
    expect(parseMoney(null, 'GHS').success).toBe(false);
    expect(parseMoney(undefined, 'GHS').success).toBe(false);
  });

  it('1.9 rejects empty string', () => {
    expect(parseMoney('', 'GHS').success).toBe(false);
  });

  it('1.10 rejects excessive decimal precision', () => {
    // GHS has 2 decimal places — 3 digits should be rejected
    expect(parseMoney('10.123', 'GHS').success).toBe(false);
  });

  it('1.11 accepts trailing zeros beyond precision', () => {
    // 10.500 → 1050 (₵10.50, the trailing zero is just padding)
    const result = parseMoney('10.500', 'GHS');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(1050);
  });

  it('1.12 handles JPY (0 decimal places)', () => {
    const result = parseMoney(1000, 'JPY');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(1000);
  });

  it('1.13 rejects malformed strings', () => {
    expect(parseMoney('abc', 'GHS').success).toBe(false);
    expect(parseMoney('10.10.10', 'GHS').success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. MONEY FORMATTING
// ═══════════════════════════════════════════════════════════════════

describe('2. Money Formatting', () => {
  it('2.1 formats 5050 GHS → "50.50"', () => {
    expect(formatMoney(5050, 'GHS')).toBe('50.50');
  });

  it('2.2 formats 2550 GHS → "25.50"', () => {
    expect(formatMoney(2550, 'GHS')).toBe('25.50');
  });

  it('2.3 formats 100 GHS → "1.00"', () => {
    expect(formatMoney(100, 'GHS')).toBe('1.00');
  });

  it('2.4 formats 0 GHS → "0.00"', () => {
    expect(formatMoney(0, 'GHS')).toBe('0.00');
  });

  it('2.5 formats 1 GHS → "0.01"', () => {
    expect(formatMoney(1, 'GHS')).toBe('0.01');
  });

  it('2.6 formats 1099 USD → "10.99"', () => {
    expect(formatMoney(1099, 'USD')).toBe('10.99');
  });

  it('2.7 formats 9900 GHS → "99.00"', () => {
    expect(formatMoney(9900, 'GHS')).toBe('99.00');
  });

  it('2.8 formats JPY (0 decimals) → "1099"', () => {
    expect(formatMoney(1099, 'JPY')).toBe('1099');
  });

  it('2.9 formatMoneyWithSymbol uses correct symbol', () => {
    expect(formatMoneyWithSymbol(5050, 'GHS')).toBe('₵50.50');
    expect(formatMoneyWithSymbol(1099, 'USD')).toBe('$10.99');
    expect(formatMoneyWithSymbol(0, 'GHS')).toBe('Free');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. FLOATING-POINT TRAP PREVENTION
// ═══════════════════════════════════════════════════════════════════

describe('3. Floating-Point Trap Prevention', () => {
  it('3.1 0.1 + 0.2 does NOT produce 0.30000000000000004', () => {
    const a = parseMoneyOrThrow(0.1, 'GHS'); // 10
    const b = parseMoneyOrThrow(0.2, 'GHS'); // 20
    const sum = addMoney(a, b);
    expect(sum).toBe(30); // 0.30 GHS = 30 pesewas
    expect(formatMoney(sum, 'GHS')).toBe('0.30');
  });

  it('3.2 10.10 + 20.20 is exactly 30.30', () => {
    const a = parseMoneyOrThrow(10.1, 'GHS'); // 1010
    const b = parseMoneyOrThrow(20.2, 'GHS'); // 2020
    const sum = addMoney(a, b);
    expect(sum).toBe(3030);
    expect(formatMoney(sum, 'GHS')).toBe('30.30');
  });

  it('3.3 price × quantity: GHS 50.00 × 3 = GHS 150.00', () => {
    const price = asMoney(5000); // GHS 50.00
    const total = multiplyMoney(price, 3);
    expect(total).toBe(15000);
    expect(formatMoney(total, 'GHS')).toBe('150.00');
  });

  it('3.4 percentage: 5% of GHS 100.00 = GHS 5.00', () => {
    const amount = asMoney(10000); // GHS 100.00
    const fee = calculatePercentage(amount, 5);
    expect(fee).toBe(500); // GHS 5.00
    expect(formatMoney(fee, 'GHS')).toBe('5.00');
  });

  it('3.5 percentage: 5% of GHS 9.99 floors to GHS 0.49', () => {
    const amount = asMoney(999); // G*HS 9.99
    const fee = calculatePercentage(amount, 5);
    expect(fee).toBe(49); // Floor(49.95) = 49 → GHS 0.49
    expect(formatMoney(fee, 'GHS')).toBe('0.49');
  });

  it('3.6 2.5% of GHS 100.00 = GHS 2.50', () => {
    const amount = asMoney(10000);
    const fee = calculatePercentage(amount, 2.5);
    expect(fee).toBe(250);
    expect(formatMoney(fee, 'GHS')).toBe('2.50');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. MONEY ARITHMETIC
// ═══════════════════════════════════════════════════════════════════

describe('4. Money Arithmetic', () => {
  it('4.1 addition', () => {
    expect(addMoney(asMoney(1000), asMoney(2000))).toBe(3000);
  });

  it('4.2 subtraction', () => {
    expect(subtractMoney(asMoney(5000), asMoney(2000))).toBe(3000);
  });

  it('4.3 subtraction returns null for negative result', () => {
    expect(subtractMoney(asMoney(1000), asMoney(2000))).toBeNull();
  });

  it('4.4 multiplication by quantity', () => {
    expect(multiplyMoney(asMoney(2500), 4)).toBe(10000);
  });

  it('4.5 multiplication rejects negative quantity', () => {
    expect(() => multiplyMoney(asMoney(1000), -1)).toThrow();
  });

  it('4.6 multiplication rejects non-integer quantity', () => {
    expect(() => multiplyMoney(asMoney(1000), 1.5)).toThrow();
  });

  it('4.7 platform fee calculation', () => {
    const amount = asMoney(29900); // GHS 299.00
    const fee = calculatePlatformFee(amount, 5); // 5% platform fee
    expect(fee).toBe(1495); // GHS 14.95
    expect(formatMoney(fee, 'GHS')).toBe('14.95');
  });

  it('4.8 organizer revenue after platform fee', () => {
    const amount = asMoney(29900); // GHS 299.00
    const revenue = calculateOrganizerRevenue(amount, 5); // 95% to organizer
    expect(revenue).toBe(28405); // GHS 284.05
    expect(formatMoney(revenue, 'GHS')).toBe('284.05');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('5. Money Validation', () => {
  it('5.1 isValidMoney accepts non-negative integers', () => {
    expect(isValidMoney(0)).toBe(true);
    expect(isValidMoney(100)).toBe(true);
    expect(isValidMoney(999999)).toBe(true);
  });

  it('5.2 isValidMoney rejects non-integers', () => {
    expect(isValidMoney(1.5)).toBe(false);
    expect(isValidMoney(NaN)).toBe(false);
    expect(isValidMoney(Infinity)).toBe(false);
  });

  it('5.3 isValidMoney rejects negative', () => {
    expect(isValidMoney(-1)).toBe(false);
  });

  it('5.4 isFree correctly identifies zero amounts', () => {
    expect(isFree(asMoney(0))).toBe(true);
    expect(isFree(asMoney(100))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. CURRENCY METADATA
// ═══════════════════════════════════════════════════════════════════

describe('6. Currency Metadata', () => {
  it('6.1 GHS has 2 decimal places', () => {
    expect(getCurrencyDecimals('GHS')).toBe(2);
    expect(getMinorUnitMultiplier('GHS')).toBe(100);
  });

  it('6.2 USD has 2 decimal places', () => {
    expect(getCurrencyDecimals('USD')).toBe(2);
    expect(getMinorUnitMultiplier('USD')).toBe(100);
  });

  it('6.3 JPY has 0 decimal places', () => {
    expect(getCurrencyDecimals('JPY')).toBe(0);
    expect(getMinorUnitMultiplier('JPY')).toBe(1);
  });

  it('6.4 unknown currency defaults to 2 decimals', () => {
    expect(getCurrencyDecimals('XYZ')).toBe(2);
    expect(getMinorUnitMultiplier('XYZ')).toBe(100);
  });

  it('6.5 DEFAULT_CURRENCY is GHS', () => {
    expect(DEFAULT_CURRENCY).toBe('GHS');
  });

  it('6.6 getCurrencySymbol returns correct symbols', () => {
    expect(getCurrencySymbol('GHS')).toBe('₵');
    expect(getCurrencySymbol('USD')).toBe('$');
    expect(getCurrencySymbol('EUR')).toBe('€');
    expect(getCurrencySymbol('GBP')).toBe('£');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. SCHEMA INTEGRITY — Monetary Fields Are Int
// ═══════════════════════════════════════════════════════════════════

describe('7. Schema Integrity — Monetary Fields Are Int', () => {
  it('7.1 SubscriptionPlan.price is stored as integer', async () => {
    const plan = await db.subscriptionPlan.findFirst({ where: { slug: 'free' } });
    expect(plan).not.toBeNull();
    expect(Number.isInteger(plan!.price)).toBe(true);
    expect(plan!.price).toBe(0); // Free plan
  });

  it('7.2 SubscriptionPlan Starter price is 9900 (GHS 99.00)', async () => {
    const plan = await db.subscriptionPlan.findFirst({ where: { slug: 'starter' } });
    expect(plan).not.toBeNull();
    expect(plan!.price).toBe(9900);
  });

  it('7.3 SubscriptionPlan Professional price is 29900 (GHS 299.00)', async () => {
    const plan = await db.subscriptionPlan.findFirst({ where: { slug: 'professional' } });
    expect(plan).not.toBeNull();
    expect(plan!.price).toBe(29900);
  });

  it('7.4 TicketType.price is stored as integer minor units', async () => {
    const ticketType = await db.ticketType.findFirst();
    expect(ticketType).not.toBeNull();
    expect(Number.isInteger(ticketType!.price)).toBe(true);
  });

  it('7.5 Booking.totalAmount is stored as integer minor units', async () => {
    const booking = await db.booking.findFirst();
    expect(booking).not.toBeNull();
    expect(Number.isInteger(booking!.totalAmount)).toBe(true);
  });

  it('7.6 Payment.amount is stored as integer minor units', async () => {
    const payment = await db.payment.findFirst();
    if (payment) { // Payments may not exist in all test states
      expect(Number.isInteger(payment.amount)).toBe(true);
      expect(Number.isInteger(payment.refundedAmount)).toBe(true);
    }
  });

  it('7.7 EventAnalytics.revenue is stored as integer minor units', async () => {
    const analytics = await db.eventAnalytics.findFirst();
    if (analytics) {
      expect(Number.isInteger(analytics.revenue)).toBe(true);
    }
  });

  it('7.8 Free tickets have price = 0', async () => {
    // Find a free event's ticket type
    const freeTicket = await db.ticketType.findFirst({ where: { price: 0 } });
    if (freeTicket) {
      expect(freeTicket.price).toBe(0);
      expect(isFree(asMoney(freeTicket.price))).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. FINANCIAL CALCULATION WITH REAL DATA
// ═══════════════════════════════════════════════════════════════════

describe('8. Financial Calculations With Real Data', () => {
  it('8.1 booking total = ticket price × quantity (integer arithmetic)', async () => {
    const booking = await db.booking.findFirst({
      where: { totalAmount: { not: 0 } },
      include: { tickets: { include: { ticketType: true } } },
    });

    if (booking && booking.tickets.length > 0) {
      // Calculate expected total from ticket prices
      let expectedTotal = 0;
      for (const ticket of booking.tickets) {
        expectedTotal += ticket.ticketType.price; // Each ticket is 1 unit
      }
      expect(booking.totalAmount).toBe(expectedTotal);
    }
  });

  it('8.2 paid bookings have a matching payment amount', async () => {
    const booking = await db.booking.findFirst({
      where: { totalAmount: { not: 0 } },
      include: { payment: true },
    });

    if (booking && booking.payment) {
      expect(booking.payment.amount).toBe(booking.totalAmount);
    }
  });

  it('8.3 platform fee calculation is deterministic', () => {
    // Run 1000 times to ensure no floating-point drift
    for (let i = 0; i < 1000; i++) {
      const amount = asMoney(29900); // GHS 299.00
      const fee = calculatePlatformFee(amount, 5);
      expect(fee).toBe(1495); // Always GHS 14.95
    }
  });
});
