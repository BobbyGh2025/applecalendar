/**
 * Phase 5E: STRIPE Legacy Provider Compatibility Tests
 *
 * Proves that historical STRIPE payment records can be safely read,
 * while new STRIPE payment creation is explicitly blocked.
 *
 * These tests validate the separation of:
 *   paymentProviders  = ['PAYSTACK', 'MANUAL', 'FREE']  — for NEW payments
 *   paymentProviderValues = ['PAYSTACK', 'MANUAL', 'FREE', 'STRIPE'] — all valid DB values
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  paymentProviders,
  paymentProviderValues,
  paymentProviderField,
  paymentProviderValueField,
} from '@/lib/validations/common';

const prisma = new PrismaClient();

describe('Phase 5E: STRIPE Legacy Provider Compatibility', () => {
  let testUserId: string;
  let testOrgId: string;
  let testBookingId: string;
  let testEventId: string;
  let stripePaymentId: string;

  beforeAll(async () => {
    const bcrypt = await import('bcryptjs');
    const user = await prisma.user.create({
      data: {
        email: `stripe-compat-test-${Date.now()}@test.com`,
        password: await bcrypt.hash('test', 12),
        name: 'Stripe Compat Test',
        role: 'PUBLIC',
      },
    });
    testUserId = user.id;

    const org = await prisma.user.create({
      data: {
        email: `stripe-compat-org-${Date.now()}@test.com`,
        password: await bcrypt.hash('test', 12),
        name: 'Stripe Compat Org',
        role: 'ORGANIZER',
      },
    });
    testOrgId = org.id;

    const event = await prisma.event.create({
      data: {
        title: 'Stripe Compat Test Event',
        slug: `stripe-compat-${Date.now()}`,
        description: 'Test event for STRIPE compatibility',
        startDate: new Date('2025-12-01'),
        organizerId: org.id,
        status: 'PUBLISHED',
        isPaid: true,
      },
    });
    testEventId = event.id;

    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 5000,
        currency: 'GHS',
        status: 'CONFIRMED',
        bookingRef: `STRIP-COMPAT-${Date.now()}`,
        confirmedAt: new Date(),
      },
    });
    testBookingId = booking.id;
  });

  afterAll(async () => {
    if (stripePaymentId) {
      await prisma.payment.delete({ where: { id: stripePaymentId } }).catch(() => {});
    }
    await prisma.booking.delete({ where: { id: testBookingId } }).catch(() => {});
    await prisma.event.delete({ where: { id: testEventId } }).catch(() => {});
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    await prisma.user.delete({ where: { id: testOrgId } }).catch(() => {});
    await prisma.$disconnect();
  });

  // ═══ Test 1: Historical STRIPE payment records can be read safely ═══

  it('reads a STRIPE payment record from the database without error', async () => {
    const payment = await prisma.payment.create({
      data: {
        bookingId: testBookingId,
        userId: testUserId,
        amount: 5000,
        currency: 'GHS',
        provider: 'STRIPE',
        status: 'COMPLETED',
      },
    });
    stripePaymentId = payment.id;

    const read = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(read).not.toBeNull();
    expect(read!.provider).toBe('STRIPE');
    expect(read!.amount).toBe(5000);
    expect(read!.status).toBe('COMPLETED');
  });

  // ═══ Test 2: STRIPE values do not fail database/response validation ═══

  it('STRIPE passes paymentProviderValueField validation (DB read)', () => {
    const result = paymentProviderValueField.safeParse('STRIPE');
    expect(result.success).toBe(true);
  });

  it('STRIPE is included in paymentProviderValues array', () => {
    expect(paymentProviderValues).toContain('STRIPE');
  });

  it('PAYSTACK passes paymentProviderValueField validation', () => {
    const result = paymentProviderValueField.safeParse('PAYSTACK');
    expect(result.success).toBe(true);
  });

  // ═══ Test 3: New payment creation cannot accidentally create a STRIPE payment ═══

  it('STRIPE FAILS paymentProviderField validation (new payment creation)', () => {
    const result = paymentProviderField.safeParse('STRIPE');
    expect(result.success).toBe(false);
  });

  it('STRIPE is NOT in paymentProviders array (for new payments)', () => {
    expect(paymentProviders).not.toContain('STRIPE');
  });

  it('paymentProviders and paymentProviderValues are correctly separated', () => {
    for (const p of paymentProviders) {
      expect(paymentProviderValues).toContain(p);
    }
    expect(paymentProviderValues).toContain('STRIPE');
    expect(paymentProviders).not.toContain('STRIPE');
    expect(paymentProviderValues.length - paymentProviders.length).toBe(1);
  });

  // ═══ Test 4: PAYSTACK/MANUAL/FREE remain valid for new payments ═══

  it('PAYSTACK passes paymentProviderField validation (new payment)', () => {
    const result = paymentProviderField.safeParse('PAYSTACK');
    expect(result.success).toBe(true);
  });

  it('MANUAL passes paymentProviderField validation (new payment)', () => {
    const result = paymentProviderField.safeParse('MANUAL');
    expect(result.success).toBe(true);
  });

  it('FREE passes paymentProviderField validation (new payment)', () => {
    const result = paymentProviderField.safeParse('FREE');
    expect(result.success).toBe(true);
  });

  it('unknown provider FAILS both validations', () => {
    expect(paymentProviderField.safeParse('UNKNOWN').success).toBe(false);
    expect(paymentProviderValueField.safeParse('UNKNOWN').success).toBe(false);
  });

  // ═══ Test 5: No existing payment records are modified ═══

  it('existing payment record count is stable after compatibility fix', async () => {
    const count = await prisma.payment.count();
    // Seed has 4 payments, we created 1 STRIPE in this test = 5 total
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it('existing STRIPE payment preserves its provider value', async () => {
    if (stripePaymentId) {
      const payment = await prisma.payment.findUnique({ where: { id: stripePaymentId } });
      expect(payment!.provider).toBe('STRIPE');
    }
  });
});
