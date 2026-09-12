import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

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

      // Restore soldCount for each ticket type (atomic decrement)
      for (const [ticketTypeId, count] of ticketTypeCounts) {
        await tx.ticketType.update({
          where: { id: ticketTypeId },
          data: { soldCount: { decrement: count } },
        });
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
