import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

/**
 * GET /api/admin/venues/:id
 * Get venue detail for admin inspection. SUPER_ADMIN only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const venue = await db.venue.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        address: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        lat: true,
        lng: true,
        googleMapsUrl: true,
        coverImage: true,
        capacity: true,
        amenities: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        website: true,
        organizerId: true,
        organizer: { select: { id: true, name: true, email: true } },
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { events: true, sessions: true },
        },
        events: {
          take: 10,
          orderBy: { startDate: 'desc' },
          select: { id: true, title: true, status: true, startDate: true },
        },
      },
    });

    if (!venue) {
      throw new ApiError(404, 'VENUE_NOT_FOUND', 'Venue not found');
    }

    return NextResponse.json({ venue });
  } catch (error) {
    return handleApiError(error);
  }
}
