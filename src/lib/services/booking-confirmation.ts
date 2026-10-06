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
 * Notification safety:
 *   - Financial state commits FIRST
 *   - Notification creation happens AFTER the financial transaction
 *   - Notification failure does NOT roll back financial state
 */

import { db } from '@/lib/db';
import { validatePaymentTransition, type PaymentTransitionResult } from './payment-state-machine';
import { PaymentNotFound, BookingNotFound, PaymentAlreadyConfirmed } from './payment-domain-errors';
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

// ─── Core: Confirm Booking on Payment Success ───

/**
 * Atomically confirm a booking after successful payment.
 *
 * Steps (inside a Prisma transaction):
 *   1. Load Payment with Booking
 *   2. If Payment is already COMPLETED → idempotent return (already confirmed)
 *   3. Validate transition: current → COMPLETED
 *   4. Update Payment: status = COMPLETED, completedAt = now, providerRef
 *   5. Update Booking: status = CONFIRMED, confirmedAt = now (conditional on PENDING)
 *   6. Activate tickets: PENDING → VALID
 *   7. Confirm inventory: reservedCount → soldCount for each ticket type
 *
 * After transaction:
 *   8. Create notification (failure does NOT roll back financial state)
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

  // 2. Idempotency: if payment is already COMPLETED, this is a duplicate
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

  // 3. Validate the payment transition
  const transition = validatePaymentTransition(payment.status, 'COMPLETED');

  // 4-7. Atomic transaction for financial state
  const result = await db.$transaction(async (tx) => {
    // 4. Update Payment status (with provider reference)
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: 'COMPLETED',
        completedAt: transition.timestampFields.completedAt ?? new Date(),
        ...(providerReference && { providerRef: providerReference }),
      },
    });

    // 5. Update Booking status (conditional — only if PENDING)
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
        // The payment remains in its pre-transaction state (PENDING/PROCESSING),
        // and the webhook event will be recorded with processingError for reconciliation.
        logger.error('Booking in non-confirmable state during payment confirmation — aborting', {
          bookingId: payment.bookingId,
          currentStatus: currentBooking?.status,
          paymentId,
        });
        throw new BookingNotFound(
          `Booking ${payment.bookingId} is in ${currentBooking?.status ?? 'unknown'} state and cannot be confirmed`,
        );
      }
    }

    // 6. Activate tickets: PENDING → VALID
    const ticketResult = await activateTickets({
      bookingId: payment.bookingId,
      tx,
    });

    // 7. Confirm inventory for each ticket type
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
    };
  });

  // 8. Create notification AFTER financial transaction commits
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
