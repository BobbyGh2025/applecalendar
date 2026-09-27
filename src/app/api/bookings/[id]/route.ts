import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

/**
 * GET /api/bookings/:id
 * Get a specific booking. Only the booking owner or SUPER_ADMIN may access.
 * Phase 4G: Booking ownership enforcement.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: bookingId } = await params;

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            coverImage: true,
            startDate: true,
            venueName: true,
            venueCity: true,
            status: true,
          },
        },
        tickets: {
          include: {
            ticketType: {
              select: { id: true, name: true, price: true, currency: true },
            },
          },
        },
        payment: {
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            method: true,
          },
        },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }

    // Ownership check: only the booking owner or SUPER_ADMIN may view
    if (booking.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view this booking');
    }

    return NextResponse.json({ booking });
  } catch (error) {
    return handleApiError(error);
  }
}
