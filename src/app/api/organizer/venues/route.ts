import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { createVenueSchema, venueQuerySchema } from '@/lib/validations';
import { getOperableOrganizerEntitlements } from '@/lib/services/entitlements';
import { resolveVenueOrganizer } from '@/lib/services/venue-auth';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * GET /api/organizer/venues
 * List venues belonging to the authenticated organizer.
 * SUPER_ADMIN can list all venues or filter by organizerId.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN', 'STAFF')(user);

    const { searchParams } = new URL(request.url);
    const parsed = venueQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { page, limit, search, city, country } = parsed.data;

    // Determine scope
    const organizerUserId = await resolveVenueOrganizer(user.id, user.role, { requireManage: false });
    const isAdmin = user.role === 'SUPER_ADMIN';

    const where: Record<string, unknown> = {};

    if (!isAdmin) {
      // Non-admin: only see own venues + public venues with no owner
      if (organizerUserId) {
        where.OR = [
          { organizerId: organizerUserId },
          { organizerId: null, isPublic: true },
        ];
      } else {
        // Staff without membership — only public venues
        where.organizerId = null;
        where.isPublic = true;
      }
    }

    // Admin can optionally filter by organizerId
    if (isAdmin) {
      const filterOrgId = searchParams.get('organizerId');
      if (filterOrgId) {
        where.organizerId = filterOrgId;
      }
    }

    if (search) {
      // Merge search into existing where clause
      const searchFilter = {
        OR: [
          { name: { contains: search } },
          { address: { contains: search } },
          { city: { contains: search } },
        ],
      };
      if (where.OR) {
        // Combine with AND
        const existingOr = where.OR;
        delete where.OR;
        where.AND = [{ OR: existingOr }, searchFilter];
      } else {
        Object.assign(where, searchFilter);
      }
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
          lat: true,
          lng: true,
          capacity: true,
          coverImage: true,
          isPublic: true,
          isActive: true,
          organizerId: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { events: true },
          },
        },
      }),
      db.venue.count({ where }),
    ]);

    return NextResponse.json({
      venues,
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

/**
 * POST /api/organizer/venues
 * Create a new venue for the authenticated organizer.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    // Organizer must be operable
    if (user.role === 'ORGANIZER') {
      await getOperableOrganizerEntitlements(user.id);
    }

    const body = await request.json();
    const parsed = createVenueSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const {
      name,
      description,
      address,
      city,
      state,
      country,
      postalCode,
      lat,
      lng,
      googleMapsUrl,
      coverImage,
      capacity,
      amenities,
      contactName,
      contactEmail,
      contactPhone,
      website,
      isPublic,
    } = parsed.data;

    // Generate unique slug
    let slug = slugify(name);
    const existingSlug = await db.venue.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    const venue = await db.venue.create({
      data: {
        name,
        slug,
        description,
        address,
        city,
        state,
        country: country || 'GH',
        postalCode,
        lat,
        lng,
        googleMapsUrl,
        coverImage,
        capacity,
        amenities: amenities ? JSON.stringify(amenities) : null,
        contactName,
        contactEmail: contactEmail || null,
        contactPhone,
        website,
        organizerId: user.role === 'SUPER_ADMIN' ? (body.organizerId || user.id) : user.id,
        isPublic: isPublic ?? false,
      },
    });

    return NextResponse.json({ venue }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
