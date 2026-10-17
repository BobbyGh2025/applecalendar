/**
 * Phase 5E Stage 2: Booking Confirmation Service
 *
 * Atomically handles successful payment completion:
 *
 *   Payment:  PENDING/PROCESSING → COMPLETED
 *   Booking:  PENDING → CONFIRMED
 *   Inventory: reservedCount-- soldCount++
 *   Tickets:   PENDING → VALID
 *
 * This MUST happen transactionally.
 * This MUST be idempotent — processing the same payment success multiple times
 * must NOT:
 *   - duplicate booking confirmation
 *   - duplicate ticket issuance
 *   - double inventory increment
 *   - duplicate confirmation side effects
 *
 * Idempotency strategy:
 *   - Use database state and conditional updates, not in-memory flags
 *   - Check Payment.status before transitioning (if already COMPLETED, skip)
 *   - Use updateMany with status guard for Booking
 *   - Ticket activation only affects PENDING tickets (VALID unchanged)
 *   - Inventory confirmation is idempotent (if reservedCount already decremented, no-op)
 *
 * Race condition handling:
 *   - When a concurrent request wins the Payment status update:
 *     - If winner transitioned to COMPLETED + CONFIRMED → idempotent (no side effects)
 *     - If winner transitioned to FAILED/EXPIRED/CANCELLED → ConfirmationRaceConflict
 *       (non-idempotent, must NOT report confirmed or send notification)
 *   - When payment is already in a terminal non-COMPLETED state:
 *     → ConfirmationPreconditionFailed (non-retriable, caller should not retry)
 *
 * Notification safety:
 *   - Financial state commits FIRST
 *   - Notification creation happens AFTER the financial transaction
 *   - Notification failure does NOT roll back financial state
 *   - No notification is sent for idempotent or conflict results
 */

import { db } from '@/lib/db';
import { validatePaymentTransition, isTerminalStatus, type PaymentTransitionResult } from './payment-state-machine';
import {
  PaymentNotFound,
  BookingNotFound,
  ConfirmationRaceConflict,
  ConfirmationPreconditionFailed,
} from './payment-domain-errors';
import { confirmReservation, releaseReservation } from './inventory';
import { activateTickets } from './ticket-service';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface ConfirmBookingOnPaymentSuccessParams {
  paymentId: string;
  /** Provider reference from the successful payment verification */
  providerReference?: string;
}

export interface ConfirmBookingResult {
  paymentId: string;
  bookingId: string;
  /** Whether the confirmation was newly performed (false = already confirmed, idempotent) */
  confirmed: boolean;
  /** Number of tickets activated */
  ticketsActivated: number;
  /** Ticket types whose inventory was confirmed */
  inventoryConfirmed: string[];
}

// ─── Test seam ───
// Narrowly scoped to the TOCTOU race window between the payment status read
// (step 1) and the conditional updateMany (step 5). In production, this is undefined
// (no-op). In tests, it allows simulating a concurrent modification that occurs
// during that gap, causing updateMany to return count=0.
let _testOnBeforeConditionalUpdate: (() => Promise<void>) | undefined;

/** @internal Test seam for simulating concurrent race — do NOT use in production code */
export function setTestOnBeforeConditionalUpdate(fn: (() => Promise<void>) | undefined) {
  _testOnBeforeConditionalUpdate = fn;
}

// ─── Terminal states that are NOT COMPLETED ───

const TERMINAL_NON_COMPLETED = new Set(['FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED']);

// ─── Core: Confirm Booking on Payment Success ───

/**
 * Atomically confirm a booking after successful payment.
 *
 * Steps (inside a Prisma transaction):
 *   1. Load Payment with Booking
 *   2. If Payment is already COMPLETED → idempotent return (already confirmed)
 *   3. If Payment is in a terminal non-COMPLETED state → ConfirmationPreconditionFailed
 *      (non-retriable — the payment will never become confirmable)
 *   4. Validate transition: current → COMPLETED
 *   5. Update Payment: status = COMPLETED, completedAt = now, providerRef
 *   6. Update Booking: status = CONFIRMED, confirmedAt = now (conditional on PENDING)
 *   7. Activate tickets: PENDING → VALID
 *   8. Confirm inventory: reservedCount → soldCount for each ticket type
 *
 * After transaction:
 *   9. Create notification (failure does NOT roll back financial state)
 *      — ONLY if confirmation was newly performed (not idempotent or conflict)
 */
export async function confirmBookingOnPaymentSuccess(
  params: ConfirmBookingOnPaymentSuccessParams,
): Promise<ConfirmBookingResult> {
  const { paymentId, providerReference } = params;

  // 1. Load the payment with its booking and tickets
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      booking: {
        select: {
          id: true,
          status: true,
          bookingRef: true,
          userId: true,
          eventId: true,
          tickets: {
            select: {
              id: true,
              ticketTypeId: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!payment) {
    throw new PaymentNotFound(paymentId);
  }

  if (!payment.booking) {
    throw new BookingNotFound(`payment:${paymentId}`);
  }

  // 2. Idempotency: if payment is already COMPLETED, this is a duplicate success
  if (payment.status === 'COMPLETED') {
    logger.info('Payment already completed — confirmation is idempotent', { paymentId });
    return {
      paymentId,
      bookingId: payment.bookingId,
      confirmed: false,
      ticketsActivated: 0,
      inventoryConfirmed: [],
    };
  }

  // 3. Pre-transition check: if payment is in a terminal non-COMPLETED state,
  //    it can never become COMPLETED. This is a non-retriable precondition failure.
  //    Without this check, validatePaymentTransition would throw InvalidPaymentTransition,
  //    which the webhook handler treats as retriable → infinite retry loop.
  if (TERMINAL_NON_COMPLETED.has(payment.status)) {
    logger.warn('Payment in terminal non-COMPLETED state — confirmation precondition failed', {
      paymentId,
      status: payment.status,
    });
    throw new ConfirmationPreconditionFailed(paymentId, payment.status);
  }

  // 4. Validate the payment transition
  const transition = validatePaymentTransition(payment.status, 'COMPLETED');

  // Test seam: simulate concurrent modification during the TOCTOU gap
  // between reading payment.status (step 1) and the conditional updateMany (step 5).
  // This is the exact window where a real concurrent process could change the
  // payment state, causing updateMany to return count=0.
  if (_testOnBeforeConditionalUpdate) {
    await _testOnBeforeConditionalUpdate();
  }

  // 5-8. Atomic transaction for financial state
  const result = await db.$transaction(async (tx) => {
    // 5. Update Payment status (with provider reference) — status guard prevents TOCTOU
    const paymentUpdate = await tx.payment.updateMany({
      where: { id: paymentId, status: payment.status },
      data: {
        status: 'COMPLETED',
        completedAt: transition.timestampFields.completedAt ?? new Date(),
        ...(providerReference && { providerRef: providerReference }),
      },
    });

    if (paymentUpdate.count === 0) {
      // A concurrent request won the status transition. Distinguish:
      //
      // CASE A: Genuine duplicate success
      //   Payment = COMPLETED, Booking = CONFIRMED
      //   → Return idempotent result. No notification. No side effects.
      //
      // CASE B: Conflicting race
      //   Payment = FAILED/EXPIRED/CANCELLED/REFUNDED, or
      //   Booking = CANCELLED/EXPIRED/REFUNDED (not CONFIRMED)
      //   → Throw ConfirmationRaceConflict. Do NOT send notification.
      //   → Caller (webhook handler) must treat as non-retriable.
      const currentState = await tx.payment.findUnique({
        where: { id: paymentId },
        select: {
          status: true,
          booking: { select: { status: true } },
        },
      });

      const currentPaymentStatus = currentState?.status ?? 'MISSING';
      const currentBookingStatus = currentState?.booking?.status ?? 'MISSING';

      if (currentPaymentStatus === 'COMPLETED' && currentBookingStatus === 'CONFIRMED') {
        // CASE A: Genuine duplicate success — idempotent
        logger.info('Concurrent payment confirmation already completed — idempotent', { paymentId });
        return { ticketsActivated: 0, inventoryConfirmed: [], alreadyConfirmed: true };
      }

      // CASE B: Conflicting race — confirmation did not occur
      // Do NOT send notification. Do NOT report a newly confirmed booking.
      logger.warn('Confirmation race conflict — payment state changed by concurrent process', {
        paymentId,
        currentPaymentStatus,
        currentBookingStatus,
      });
      throw new ConfirmationRaceConflict(paymentId, currentPaymentStatus, currentBookingStatus);
    }

    // 6. Update Booking status (conditional — only if PENDING)
    const bookingUpdate = await tx.booking.updateMany({
      where: { id: payment.bookingId, status: 'PENDING' },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });

    // If booking was already CONFIRMED (edge case), that's fine — idempotent
    if (bookingUpdate.count === 0) {
      // Check if already confirmed (idempotent case)
      const currentBooking = await tx.booking.findUnique({
        where: { id: payment.bookingId },
        select: { status: true },
      });

      if (currentBooking?.status === 'CONFIRMED') {
        // Already confirmed — idempotent, continue to activate tickets and confirm inventory
        logger.info('Booking already confirmed during payment success (idempotent)', {
          bookingId: payment.bookingId,
        });
      } else {
        // Booking is in CANCELLED, EXPIRED, REFUNDED, or other non-confirmable state.
        // ABORT the transaction — we must not:
        //   - Activate tickets on a cancelled booking
        //   - Confirm inventory on a cancelled booking
        //   - Create VALID tickets for an unconfirmable booking
        // The payment update will be rolled back, and the webhook event will be
        // recorded with processingError for reconciliation.
        logger.error('Booking in non-confirmable state during payment confirmation — aborting', {
          bookingId: payment.bookingId,
          currentStatus: currentBooking?.status,
          paymentId,
        });
        throw new ConfirmationRaceConflict(
          paymentId,
          'COMPLETED', // We just set payment to COMPLETED in step 5
          currentBooking?.status ?? 'UNKNOWN',
        );
      }
    }

    // 7. Activate tickets: PENDING → VALID
    const ticketResult = await activateTickets({
      bookingId: payment.bookingId,
      tx,
    });

    // 8. Confirm inventory for each ticket type
    const ticketTypeQuantities = new Map<string, number>();
    for (const ticket of payment.booking.tickets) {
      const current = ticketTypeQuantities.get(ticket.ticketTypeId) ?? 0;
      ticketTypeQuantities.set(ticket.ticketTypeId, current + 1);
    }

    const inventoryConfirmed: string[] = [];
    for (const [ticketTypeId, quantity] of ticketTypeQuantities) {
      await confirmReservation({ ticketTypeId, quantity, tx });
      inventoryConfirmed.push(ticketTypeId);
    }

    return {
      ticketsActivated: ticketResult.activated,
      inventoryConfirmed,
      alreadyConfirmed: false,
    };
  });

  // A concurrent request completed the payment while this request was running.
  // Return a duplicate-success result WITHOUT sending a notification or
  // reporting a newly confirmed booking.
  if (result.alreadyConfirmed) {
    return {
      paymentId,
      bookingId: payment.bookingId,
      confirmed: false,
      ticketsActivated: 0,
      inventoryConfirmed: [],
    };
  }

  // 9. Create notification AFTER financial transaction commits
  //    ONLY when confirmation was newly performed (not idempotent or conflict).
  try {
    await db.notification.create({
      data: {
        userId: payment.booking.userId,
        title: 'Payment Confirmed',
        message: `Your payment for booking ${payment.booking.bookingRef} has been confirmed. Your tickets are now valid.`,
        type: 'PAYMENT',
      },
    });
  } catch (notificationError) {
    // Notification failure does NOT roll back financial state
    logger.error('Failed to create payment confirmation notification', {
      paymentId,
      bookingId: payment.bookingId,
      error: notificationError instanceof Error ? notificationError.message : 'unknown',
    });
  }

  logger.info('Booking confirmed on payment success', {
    paymentId,
    bookingId: payment.bookingId,
    ticketsActivated: result.ticketsActivated,
    inventoryConfirmed: result.inventoryConfirmed,
  });

  return {
    paymentId,
    bookingId: payment.bookingId,
    confirmed: true,
    ticketsActivated: result.ticketsActivated,
    inventoryConfirmed: result.inventoryConfirmed,
  };
}
