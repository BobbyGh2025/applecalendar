import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, ApiError } from '@/lib/errors';
import { filterPublicVenueFields } from '@/lib/services/venue-auth';

/**
 * GET /api/venues/:id
 * Public venue detail — returns a single public, active venue.
 * No authentication required. Private contact info is stripped.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
        website: true,
        isPublic: true,
        isActive: true,
        // Deliberately EXCLUDED: contactName, contactEmail, contactPhone, organizerId
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { events: true, sessions: true },
        },
      },
    });

    if (!venue) {
      throw new ApiError(404, 'VENUE_NOT_FOUND', 'Venue not found');
    }

    // Only return public, active venues
    if (!venue.isPublic || !venue.isActive) {
      throw new ApiError(404, 'VENUE_NOT_FOUND', 'Venue not found');
    }

    return NextResponse.json({ venue: filterPublicVenueFields(venue) });
  } catch (error) {
    return handleApiError(error);
  }
}
