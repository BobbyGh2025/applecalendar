/**
 * Phase 5E Stage 2: Payment Expiry Service
 *
 * Domain service for expiring unpaid payments and their associated bookings.
 * NO cron/API endpoint is created in Stage 2 — this is the domain logic only.
 *
 * Responsibilities:
 *   - Identify expired PENDING/PROCESSING payments (where expiresAt < now)
 *   - Transition them to EXPIRED through the state machine
 *   - Expire/cancel the associated booking
 *   - Release reserved inventory
 *   - Transition unpaid tickets to EXPIRED
 *   - Be safe to run repeatedly (idempotent)
 *
 * Idempotency:
 *   - If a payment is already EXPIRED/CANCELLED/COMPLETED, skip it
 *   - If inventory is already released, no-op
 *   - If tickets are already expired, no-op
 *
 * Notification:
 *   - Financial state commits first
 *   - Notification failure does not roll back expiry
 */

import { db } from '@/lib/db';
import { validatePaymentTransition, canBeExpired, type PaymentStatus } from './payment-state-machine';
import { releaseReservation } from './inventory';
import { expireTickets } from './ticket-service';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface ExpirePaymentsResult {
  /** Number of payments expired */
  expired: number;
  /** IDs of expired payment IDs */
  expiredPaymentIds: string[];
  /** Number of bookings that were expired/cancelled */
  bookingsExpired: number;
  /** Any errors encountered (logged but not thrown) */
  errors: Array<{ paymentId: string; error: string }>;
}

export interface ExpireSinglePaymentParams {
  paymentId: string;
}

// ─── Core: Expire All Eligible Payments ───

/**
 * Find and expire all payments that have passed their expiry time.
 *
 * This is designed to be called periodically (e.g., by a cron job in Stage 5).
 * It processes each payment individually in its own transaction,
 * so one failure does not block others.
 */
export async function expireEligiblePayments(): Promise<ExpirePaymentsResult> {
  const now = new Date();

  // Find all PENDING/PROCESSING payments with expiresAt in the past
  const expiredPayments = await db.payment.findMany({
    where: {
      status: { in: ['PENDING', 'PROCESSING'] },
      expiresAt: { lte: now },
    },
    select: { id: true },
  });

  const result: ExpirePaymentsResult = {
    expired: 0,
    expiredPaymentIds: [],
    bookingsExpired: 0,
    errors: [],
  };

  for (const payment of expiredPayments) {
    try {
      const expiryResult = await expireSinglePayment({ paymentId: payment.id });
      result.expired++;
      result.expiredPaymentIds.push(payment.id);
      if (expiryResult.bookingExpired) {
        result.bookingsExpired++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push({ paymentId: payment.id, error: errorMessage });
      logger.error('Failed to expire payment', { paymentId: payment.id, error: errorMessage });
    }
  }

  logger.info('Payment expiry sweep complete', {
    expired: result.expired,
    errors: result.errors.length,
  });

  return result;
}

// ─── Core: Expire Single Payment ───

/**
 * Expire a single payment and its associated booking/inventory/tickets.
 *
 * This MUST be idempotent — safe to call multiple times.
 */
export async function expireSinglePayment(
  params: ExpireSinglePaymentParams,
): Promise<{ paymentExpired: boolean; bookingExpired: boolean; inventoryReleased: string[]; ticketsExpired: number }> {
  const { paymentId } = params;

  // 1. Load the payment with booking and tickets
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      booking: {
        select: {
          id: true,
          status: true,
          userId: true,
          bookingRef: true,
          tickets: {
            select: { id: true, ticketTypeId: true, status: true },
          },
        },
      },
    },
  });

  if (!payment) {
    logger.warn('Payment not found for expiry', { paymentId });
    return { paymentExpired: false, bookingExpired: false, inventoryReleased: [], ticketsExpired: 0 };
  }

  // 2. Check if payment can be expired
  if (!canBeExpired(payment.status as PaymentStatus)) {
    logger.info('Payment cannot be expired (wrong status)', { paymentId, status: payment.status });
    return { paymentExpired: false, bookingExpired: false, inventoryReleased: [], ticketsExpired: 0 };
  }

  // 3. Validate transition through state machine
  const transition = validatePaymentTransition(payment.status, 'EXPIRED');

  // 4. Atomic transaction for expiry
  const inventoryReleased: string[] = [];
  let ticketsExpired = 0;

  await db.$transaction(async (tx) => {
    // 4a. Transition Payment → EXPIRED — status guard prevents TOCTOU
    const paymentUpdate = await tx.payment.updateMany({
      where: { id: paymentId, status: payment.status },
      data: { status: 'EXPIRED' },
    });

    if (paymentUpdate.count === 0) {
      // Lost race: another process already transitioned this payment.
      // Do not release inventory or cancel booking — the winning process is responsible.
      logger.info('Payment status changed by concurrent process — expiry is idempotent', {
        paymentId,
        expectedStatus: payment.status,
      });
      return;
    }

    // 4b. Transition Booking → CANCELLED (if PENDING)
    if (payment.booking && payment.booking.status === 'PENDING') {
      await tx.booking.updateMany({
        where: { id: payment.booking.id, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          cancellationReason: 'Payment expired',
        },
      });
    }

    // 4c. Release reserved inventory
    if (payment.booking) {
      const ticketTypeCounts = new Map<string, number>();
      for (const ticket of payment.booking.tickets) {
        const count = ticketTypeCounts.get(ticket.ticketTypeId) ?? 0;
        ticketTypeCounts.set(ticket.ticketTypeId, count + 1);
      }
      for (const [ticketTypeId, quantity] of ticketTypeCounts) {
        await releaseReservation({ ticketTypeId, quantity, tx });
        inventoryReleased.push(ticketTypeId);
      }
    }

    // 4d. Expire PENDING tickets
    if (payment.booking) {
      const ticketResult = await expireTickets({ bookingId: payment.booking.id, tx });
      ticketsExpired = ticketResult.expired;
    }
  });

  // 5. Notification (after transaction commits)
  if (payment.booking) {
    try {
      await db.notification.create({
        data: {
          userId: payment.booking.userId,
          title: 'Payment Expired',
          message: `Your payment for booking ${payment.booking.bookingRef} has expired. Please try booking again.`,
          type: 'PAYMENT',
        },
      });
    } catch (notificationError) {
      logger.error('Failed to create payment expiry notification', {
        paymentId,
        error: notificationError instanceof Error ? notificationError.message : 'unknown',
      });
    }
  }

  logger.info('Payment expired', {
    paymentId,
    bookingExpired: payment.booking?.status === 'PENDING',
    inventoryReleased,
    ticketsExpired,
  });

  return {
    paymentExpired: true,
    bookingExpired: payment.booking?.status === 'PENDING',
    inventoryReleased,
    ticketsExpired,
  };
}

// ─── Query: Count Expirable Payments ───

/**
 * Count payments that are eligible for expiry (for monitoring/cron planning).
 */
export async function countExpirablePayments(): Promise<number> {
  const now = new Date();
  return db.payment.count({
    where: {
      status: { in: ['PENDING', 'PROCESSING'] },
      expiresAt: { lte: now },
    },
  });
}
