/**
 * PATCH /api/bookings/:id/cancel
 *
 * Cancel a booking (Phase 5E Stage 3 Closure):
 *
 * For CONFIRMED bookings (paid or free, payment completed):
 *   - Booking → CANCELLED
 *   - Tickets → CANCELLED
 *   - soldCount decremented (restoreSoldCount)
 *   - PENDING payments → CANCELLED (shouldn't exist for CONFIRMED, but defensive)
 *   - COMPLETED payments remain COMPLETED (refund is separate action)
 *
 * For PENDING bookings (paid, awaiting payment):
 *   - Booking → CANCELLED
 *   - Tickets → CANCELLED
 *   - reservedCount decremented (releaseReservation)
 *   - PENDING/PROCESSING payments → CANCELLED
 *
 * Only the booking owner or SUPER_ADMIN may cancel.
 * Idempotent: double-cancel is a conflict error.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { releaseReservation, restoreSoldCount } from '@/lib/services/inventory';
import { logger } from '@/lib/logger';
import { dispatchNotification, NotificationType } from '@/lib/services/notification-service';
import { z } from 'zod';

const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: bookingId } = await params;

    // Find the booking with tickets
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: {
        tickets: {
          select: { id: true, ticketTypeId: true, status: true },
        },
        event: {
          select: { id: true, title: true },
        },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
    }

    // Ownership check: only the booking owner or SUPER_ADMIN may cancel
    if (booking.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to cancel this booking');
    }

    // Only CONFIRMED or PENDING bookings can be cancelled
    if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING') {
      throw new ApiError(
        400,
        'INVALID_STATUS',
        `Cannot cancel booking with status ${booking.status}. Only confirmed or pending bookings can be cancelled.`
      );
    }

    // Parse optional cancellation reason
    let cancellationReason: string | undefined;
    try {
      const body = await request.json();
      const parsed = cancelBookingSchema.safeParse(body);
      if (parsed.success) {
        cancellationReason = parsed.data.reason;
      }
    } catch {
      // No body or invalid JSON — no reason provided, that's fine
    }

    // Classify tickets for logging/notification counts only — inventory
    // operations are classified from FRESH in-transaction state (H-4 below),
    // because this snapshot can be stale under the cancel-vs-confirm race.
    const validTickets = booking.tickets.filter(t => t.status === 'VALID');
    const pendingTickets = booking.tickets.filter(t => t.status === 'PENDING');

    // Perform cancellation transactionally
    const result = await db.$transaction(async (tx) => {
      // Conditional update to prevent double-cancel race
      const updateResult = await tx.booking.updateMany({
        where: { id: bookingId, status: { in: ['CONFIRMED', 'PENDING'] } },
        data: {
          status: 'CANCELLED',
          cancelledBy: user.id,
          cancellationReason: cancellationReason ?? null,
        },
      });

      if (updateResult.count === 0) {
        throw new ApiError(409, 'CONFLICT', 'Booking has already been cancelled or is no longer cancellable');
      }

      // Phase 6D verification (H-4): re-read ticket statuses INSIDE the
      // transaction, after the conditional booking update. The pre-transaction
      // snapshot can be stale: if confirmBookingOnPaymentSuccess commits
      // between the snapshot and this transaction (exactly when users hit
      // cancel after paying), the snapshot says PENDING while the tickets are
      // actually VALID/sold — classifying from the snapshot then released
      // reservedCount that was already zeroed and NEVER restored soldCount,
      // permanently leaking inventory. Classification now derives from the
      // in-transaction state, which is correct for every interleaving.
      const freshTickets = await tx.ticket.findMany({
        where: {
          bookingId,
          status: { in: ['PENDING', 'VALID'] },
        },
        select: { id: true, ticketTypeId: true, status: true },
      });

      // Cancel all valid and pending tickets (freshly observed)
      await tx.ticket.updateMany({
        where: {
          bookingId,
          status: { in: ['PENDING', 'VALID'] },
        },
        data: {
          status: 'CANCELLED',
        },
      });

      // Classify by CURRENT status for inventory operations
      const validTicketTypeCounts = new Map<string, number>();
      const pendingTicketTypeCounts = new Map<string, number>();
      for (const ticket of freshTickets) {
        if (ticket.status === 'VALID') {
          validTicketTypeCounts.set(ticket.ticketTypeId, (validTicketTypeCounts.get(ticket.ticketTypeId) || 0) + 1);
        } else {
          pendingTicketTypeCounts.set(ticket.ticketTypeId, (pendingTicketTypeCounts.get(ticket.ticketTypeId) || 0) + 1);
        }
      }

      // ─── Sold tickets: restore soldCount ───
      // These tickets were sold (payment completed), so we decrement soldCount
      for (const [ticketTypeId, count] of validTicketTypeCounts) {
        await restoreSoldCount(ticketTypeId, count, tx);
      }

      // ─── Reserved tickets: release reservedCount ───
      // These tickets were reserved but not sold (payment not completed), so we decrement reservedCount
      for (const [ticketTypeId, count] of pendingTicketTypeCounts) {
        await releaseReservation({ ticketTypeId, quantity: count, tx });
      }

      // ─── Payment status updates ───
      // COMPLETED payments remain COMPLETED (refund is a separate action)
      // PENDING/PROCESSING payments → CANCELLED (charge was never completed)
      await tx.payment.updateMany({
        where: { bookingId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      // Notification will be created AFTER transaction commits

      return tx.booking.findUnique({
        where: { id: bookingId },
      });
    });

    logger.info('Booking cancelled', {
      bookingId,
      previousStatus: booking.status,
      cancelledBy: user.id,
      validTicketsReleased: validTickets.length,
      pendingTicketsReleased: pendingTickets.length,
    });

    // Notify user of cancellation — AFTER transaction commits
    // Notification failure does NOT roll back the cancellation
    try {
      await dispatchNotification({
        userId: booking.userId,
        title: 'Booking Cancelled',
        message: `Your booking ${booking.bookingRef} for "${booking.event.title}" has been cancelled. ${(validTickets.length + pendingTickets.length)} ticket(s) released.`,
        type: NotificationType.BOOKING,
        eventId: booking.event.id,
        relatedEntityId: bookingId,
        relatedEntityType: 'Booking',
        dedupKey: `booking-cancelled-${bookingId}`,
        link: `/events/${booking.event.id}`,
      });
    } catch (notificationError) {
      logger.error('Failed to send booking cancellation notification', {
        bookingId,
        error: notificationError instanceof Error ? notificationError.message : 'unknown',
      });
    }

    return NextResponse.json({
      success: true,
      booking: result,
      message: 'Booking cancelled successfully. Tickets have been released.',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
