import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

/**
 * GET /api/organizer/bookings
 * List all bookings for events owned by the authenticated organizer.
 * Phase 4G: Organizer booking management — tenant-scoped.
 *
 * Supports optional query params:
 * - eventId: filter by specific event
 * - status: filter by booking status
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId') || undefined;
    const status = searchParams.get('status') || undefined;

    const where: Record<string, unknown> = {};

    // SUPER_ADMIN sees all bookings; organizers see only their events
    if (user.role !== 'SUPER_ADMIN') {
      where.event = { organizerId: user.id };
    }

    if (eventId) {
      where.eventId = eventId;
      // Verify the organizer owns this event (unless SUPER_ADMIN)
      if (user.role !== 'SUPER_ADMIN') {
        const event = await db.event.findFirst({
          where: { id: eventId, organizerId: user.id },
        });
        if (!event) {
          throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view bookings for this event');
        }
      }
    }

    if (status) {
      where.status = status;
    }

    const bookings = await db.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            startDate: true,
            venueName: true,
            status: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
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
            provider: true,
          },
        },
      },
    });

    return NextResponse.json({ bookings });
  } catch (error) {
    return handleApiError(error);
  }
}
