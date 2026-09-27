import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, ApiError } from '@/lib/errors';
import { paginationSchema } from '@/lib/validations';
import { filterPublicVenueFields } from '@/lib/services/venue-auth';

/**
 * GET /api/venues
 * Public venue listing — returns only public, active venues.
 * No authentication required. Private contact info is stripped.
 *
 * Query params:
 * - page, limit (pagination)
 * - search (name/address/city)
 * - city (filter)
 * - country (filter)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = paginationSchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { page, limit } = parsed.data;
    const search = searchParams.get('search') || '';
    const city = searchParams.get('city') || '';
    const country = searchParams.get('country') || '';

    const where: Record<string, unknown> = {
      isPublic: true,
      isActive: true,
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { address: { contains: search } },
        { city: { contains: search } },
      ];
    }
    if (city) {
      where.city = city;
    }
    if (country) {
      where.country = country;
    }

    const skip = (page - 1) * limit;

    const [venues, total] = await Promise.all([
      db.venue.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
          // Deliberately EXCLUDED: contactName, contactEmail, contactPhone, organizerId
          createdAt: true,
          _count: {
            select: { events: true },
          },
        },
      }),
      db.venue.count({ where }),
    ]);

    // Apply public field filter to each venue
    const publicVenues = venues.map((v) => filterPublicVenueFields(v));

    return NextResponse.json({
      venues: publicVenues,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
