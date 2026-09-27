import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';

const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
}).strict();

/**
 * PATCH /api/bookings/:id/cancel
 * Cancel a confirmed booking. Transactional: booking status + ticket cancellation + soldCount restoration.
 * Only the booking owner or SUPER_ADMIN may cancel.
 * Only CONFIRMED bookings can be cancelled (not already cancelled/refunded).
 */
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

    // Only CONFIRMED bookings can be cancelled
    if (booking.status !== 'CONFIRMED') {
      throw new ApiError(
        400,
        'INVALID_STATUS',
        `Cannot cancel booking with status ${booking.status}. Only confirmed bookings can be cancelled.`
      );
    }

    // Phase 4G: Parse optional cancellation reason
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

    // Count valid tickets to restore
    const validTickets = booking.tickets.filter(t => t.status === 'VALID');
    const ticketTypeCounts = new Map<string, number>();
    for (const ticket of validTickets) {
      const count = ticketTypeCounts.get(ticket.ticketTypeId) || 0;
      ticketTypeCounts.set(ticket.ticketTypeId, count + 1);
    }

    // Perform cancellation transactionally
    const result = await db.$transaction(async (tx) => {
      // Update booking status (with cancellation audit fields)
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          cancelledBy: user.id,
          cancellationReason: cancellationReason ?? null,
        },
      });

      // Cancel all valid tickets
      await tx.ticket.updateMany({
        where: {
          bookingId,
          status: 'VALID',
        },
        data: {
          status: 'CANCELLED',
        },
      });

      // Restore soldCount for each ticket type (atomic decrement with safety guard)
      // Phase 4G: Use updateMany with soldCount >= count guard to prevent
      // soldCount from going below 0 due to data inconsistency.
      for (const [ticketTypeId, count] of ticketTypeCounts) {
        const decResult = await tx.ticketType.updateMany({
          where: {
            id: ticketTypeId,
            soldCount: { gte: count }, // Safety: only decrement if enough soldCount exists
          },
          data: { soldCount: { decrement: count } },
        });
        // If the guard prevented the decrement, force soldCount to 0 (data repair)
        if (decResult.count === 0) {
          await tx.ticketType.update({
            where: { id: ticketTypeId },
            data: { soldCount: 0 },
          });
        }
      }

      // Update payment status if exists
      await tx.payment.updateMany({
        where: { bookingId },
        data: { status: 'REFUNDED' },
      });

      // Create notification
      await tx.notification.create({
        data: {
          userId: booking.userId,
          title: 'Booking Cancelled',
          message: `Your booking ${booking.bookingRef} for "${booking.event.title}" has been cancelled. ${validTickets.length} ticket(s) released.`,
          type: 'BOOKING',
        },
      });

      return updatedBooking;
    });

    return NextResponse.json({
      success: true,
      booking: result,
      message: 'Booking cancelled successfully. Tickets have been released.',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
