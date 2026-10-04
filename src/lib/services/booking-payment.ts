/**
 * Phase 5E Stage 2: Booking Payment Service
 *
 * Central service for creating and managing the relationship between
 * bookings and payments. Ensures:
 *
 * - Paid bookings start as PENDING (NOT CONFIRMED)
 * - Payment initialization ≠ successful payment
 * - Free bookings get a COMPLETED FREE payment immediately
 * - Idempotency keys prevent duplicate payment creation
 * - Correct provider selection (PAYSTACK for paid, FREE for free)
 * - Expiry timestamps are set correctly
 *
 * CRITICAL DISTINCTION:
 *   For paid bookings:
 *     Booking = PENDING, Payment = PENDING, Tickets = PENDING
 *   Payment completion later causes:
 *     Booking = CONFIRMED, Payment = COMPLETED, Tickets = VALID
 *
 *   For free bookings:
 *     Booking = CONFIRMED, Payment = COMPLETED, Tickets = VALID (immediately)
 */

import crypto from 'crypto';
import { db } from '@/lib/db';
import { paymentProviders } from '@/lib/validations/common';
import { ProviderNotSupported } from './payment-domain-errors';
import { validatePaymentMoneyConstraints } from '@/lib/money-constraints';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface CreateBookingPaymentParams {
  bookingId: string;
  userId: string;
  /** Amount in integer minor units */
  amount: number;
  /** ISO 4217 currency code */
  currency: string;
  /** Provider override (defaults to PAYSTACK for paid, FREE for free) */
  provider?: string;
  /** Idempotency key (generated if not provided) */
  idempotencyKey?: string;
  /** Payment expiry in minutes from now (defaults to env.PAYMENT_EXPIRY_MINUTES) */
  expiryMinutes?: number;
}

export interface CreateBookingPaymentResult {
  paymentId: string;
  provider: string;
  status: string;
  idempotencyKey: string;
  /** Whether the booking/payment requires further action (payment pending) */
  requiresPaymentAction: boolean;
  /** Authorization URL if provider returned one (null for FREE/MANUAL) */
  authorizationUrl: string | null;
  /** Expiry time for the payment (if applicable) */
  expiresAt: Date | null;
}

// ─── Idempotency Key Generation ───

/**
 * Generate a unique idempotency key for a payment.
 * Format: pay-{timestamp}-{random}
 */
export function generateIdempotencyKey(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  return `pay-${timestamp}-${random}`;
}

// ─── Core: Determine Provider ───

/**
 * Determine the correct payment provider for a booking.
 * - Free bookings (amount = 0) → FREE
 * - Paid bookings → PAYSTACK (default) or explicitly specified
 * - STRIPE is never allowed for new payments
 */
export function determineProvider(amount: number, requestedProvider?: string): string {
  // Free events always use FREE provider
  if (amount === 0) {
    return 'FREE';
  }

  // If a provider was explicitly requested, validate it
  if (requestedProvider) {
    if (!paymentProviders.includes(requestedProvider as typeof paymentProviders[number])) {
      throw new ProviderNotSupported(requestedProvider);
    }
    // FREE is only valid for zero-amount bookings
    if (requestedProvider === 'FREE') {
      throw new ProviderNotSupported('FREE');
    }
    return requestedProvider;
  }

  // Default: PAYSTACK for paid bookings
  return 'PAYSTACK';
}

// ─── Core: Create Payment for Booking ───

/**
 * Create a Payment record for a booking.
 *
 * For paid bookings:
 *   - Payment status = PENDING
 *   - Booking status should already be PENDING
 *   - Expiry timestamp set based on PAYMENT_EXPIRY_MINUTES
 *
 * For free bookings:
 *   - Payment status = COMPLETED (immediately)
 *   - No expiry
 *
 * This service does NOT modify the Booking — that is the caller's responsibility.
 * This separation ensures the booking creation flow can compose operations correctly.
 */
export async function createBookingPayment(
  params: CreateBookingPaymentParams,
): Promise<CreateBookingPaymentResult> {
  const {
    bookingId,
    userId,
    amount,
    currency,
    provider: requestedProvider,
    idempotencyKey,
    expiryMinutes,
  } = params;

  // 1. Validate money constraints
  validatePaymentMoneyConstraints({ amount });

  // 2. Determine provider
  const provider = determineProvider(amount, requestedProvider);

  // 3. Determine payment status
  const isFree = amount === 0;
  const status = isFree ? 'COMPLETED' : 'PENDING';

  // 4. Generate or use provided idempotency key
  const key = idempotencyKey ?? generateIdempotencyKey();

  // 5. Calculate expiry (only for pending payments)
  let expiresAt: Date | null = null;
  if (!isFree) {
    const minutes = expiryMinutes ?? env.PAYMENT_EXPIRY_MINUTES;
    expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  }

  // 6. Create the Payment record
  const payment = await db.payment.create({
    data: {
      bookingId,
      userId,
      amount,
      currency,
      provider,
      status,
      idempotencyKey: key,
      expiresAt,
      // For free payments, set completedAt immediately
      completedAt: isFree ? new Date() : null,
    },
    select: {
      id: true,
      provider: true,
      status: true,
      idempotencyKey: true,
      expiresAt: true,
    },
  });

  logger.info('Payment created for booking', {
    paymentId: payment.id,
    bookingId,
    provider,
    status,
    amount,
    currency,
  });

  return {
    paymentId: payment.id,
    provider: payment.provider,
    status: payment.status,
    idempotencyKey: payment.idempotencyKey!,
    requiresPaymentAction: !isFree,
    authorizationUrl: null, // Will be populated by provider.initializePayment in Stage 3/5
    expiresAt: payment.expiresAt,
  };
}

// ─── Core: Get Payment for Booking ───

/**
 * Get the payment associated with a booking.
 * Since Payment→Booking is one-to-one (bookingId is @unique), there's at most one.
 */
export async function getPaymentForBooking(bookingId: string): Promise<{
  id: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  providerRef: string | null;
  idempotencyKey: string | null;
  expiresAt: Date | null;
  completedAt: Date | null;
} | null> {
  const payment = await db.payment.findUnique({
    where: { bookingId },
    select: {
      id: true,
      amount: true,
      currency: true,
      provider: true,
      status: true,
      providerRef: true,
      idempotencyKey: true,
      expiresAt: true,
      completedAt: true,
    },
  });

  return payment;
}

// ─── Core: Does Booking Require Payment? ───

/**
 * Determine whether a booking requires payment action.
 * A booking requires payment if it has a PENDING payment.
 */
export async function doesBookingRequirePayment(bookingId: string): Promise<boolean> {
  const payment = await db.payment.findUnique({
    where: { bookingId },
    select: { status: true },
  });

  if (!payment) return false;
  return payment.status === 'PENDING' || payment.status === 'PROCESSING';
}
