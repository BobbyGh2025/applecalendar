import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { createEventSchema, eventQuerySchema } from '@/lib/validations';
import { getOperableOrganizerEntitlements, getOrganizerUsage, requireWithinLimit } from '@/lib/services/entitlements';
import { verifyVenueAssignment } from '@/lib/services/venue-auth';
import { filterPublicEventFields, filterPublicParticipantFields, isEventPubliclyVisible } from '@/lib/services/event-auth';

import { slugify } from '@/lib/utils/slugify';

function getDateFilter(dateFilter: string | null) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (dateFilter) {
    case 'thisWeek': {
      const endOfWeek = new Date(today);
      endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
      return { gte: today, lte: endOfWeek };
    }
    case 'thisMonth': {
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
      return { gte: today, lte: endOfMonth };
    }
    case 'nextMonth': {
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const endOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59);
      return { gte: nextMonth, lte: endOfNextMonth };
    }
    case 'all':
    default:
      return undefined;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const parsed = eventQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { page, limit, search = '', category, date, featured, status, city, isFree, venue } = parsed.data;

    // Check if user is authenticated (optional)
    let authUser: { id: string; role: string } | null = null;
    try {
      authUser = await authenticate(request);
    } catch {
      // Not authenticated — public access
    }

    const isPublicUser = !authUser || !['ORGANIZER', 'SUPER_ADMIN', 'STAFF'].includes(authUser.role);

    const where: Record<string, unknown> = {};

    // Public users only see publicly visible events (PUBLISHED, CANCELLED, COMPLETED)
    // For listing, only PUBLISHED is shown by default (CANCELLED/COMPLETED shown only via direct link)
    if (isPublicUser) {
      where.status = 'PUBLISHED';
    } else if (status) {
      where.status = status;
    }

    // Phase 4F: Enhanced search — includes venue name and city
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { venueName: { contains: search } },
        { venueCity: { contains: search } },
        { category: { name: { contains: search } } },
      ];
    }

    if (category) {
      where.category = { slug: category };
    }

    if (date) {
      const dateRange = getDateFilter(date);
      if (dateRange) {
        where.startDate = dateRange;
      }
    }

    if (featured === true) {
      where.isFeatured = true;
    }

    // Phase 4F: City filter
    if (city) {
      where.venueCity = city;
    }

    // Phase 4F: Free/paid filter
    if (isFree === true) {
      where.isPaid = false;
    }

    // Phase 4F: Venue name filter
    if (venue) {
      where.venueName = { contains: venue };
    }

    const skip = (page - 1) * limit;

    const [events, total] = await Promise.all([
      db.event.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startDate: 'asc' },
        include: {
          category: { select: { id: true, name: true, slug: true, icon: true, color: true } },
          ticketTypes: {
            select: { id: true, name: true, price: true, quantity: true, soldCount: true, currency: true },
          },
          organizer: { select: { id: true, name: true, avatar: true } },
          venue: { select: { id: true, name: true, slug: true, address: true, city: true, state: true, country: true, lat: true, lng: true, googleMapsUrl: true, website: true } },
          _count: { select: { reviews: true, bookings: true } },
        },
      }),
      db.event.count({ where }),
    ]);

    // Phase 4F: Filter private fields for public users
    const publicEvents = isPublicUser
      ? events.map(e => filterPublicEventFields(e))
      : events;

    return NextResponse.json({
      events: publicEvents,
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

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    // Phase 4B: Entitlement enforcement — organizer must be operable
    if (user.role === 'ORGANIZER') {
      const entitlements = await getOperableOrganizerEntitlements(user.id);

      // Enforce maxEvents limit
      const usage = await getOrganizerUsage(entitlements.organizerId);
      requireWithinLimit(usage.events, entitlements.limits.maxEvents, 'events', entitlements.planSlug);
    }

    const body = await request.json();

    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const {
      title,
      description,
      shortDescription,
      coverImage,
      startDate,
      endDate,
      startTime,
      endTime,
      timezone,
      venueId,
      venueName,
      venueAddress,
      venueCity,
      venueState,
      venueCountry,
      venueLat,
      venueLng,
      isVirtual,
      virtualUrl,
      capacity,
      categoryId,
      isFeatured,
      isPaid,
      currency,
      tags,
      ticketTypes,
    } = parsed.data;

    // Phase 4E: If venueId is provided, verify the venue belongs to this organizer
    // and populate inline venue fields from the venue record
    let effectiveVenueId: string | undefined = venueId;
    let effectiveVenueName = venueName;
    let effectiveVenueAddress = venueAddress;
    let effectiveVenueCity = venueCity;
    let effectiveVenueState: string | null | undefined = venueState;
    let effectiveVenueCountry = venueCountry;
    let effectiveVenueLat: number | null | undefined = venueLat;
    let effectiveVenueLng: number | null | undefined = venueLng;

    if (venueId) {
      const venueInfo = await verifyVenueAssignment(venueId, user.id, user.role);
      // Populate inline venue fields from the Venue record
      effectiveVenueName = venueInfo.name;
      effectiveVenueAddress = venueInfo.address;
      effectiveVenueCity = venueInfo.city;
      effectiveVenueState = venueInfo.state;
      effectiveVenueCountry = venueInfo.country;
      effectiveVenueLat = venueInfo.lat;
      effectiveVenueLng = venueInfo.lng;
    }

    let slug = slugify(title);
    // Ensure slug is unique
    const existingSlug = await db.event.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    const event = await db.event.create({
      data: {
        title,
        slug,
        description,
        shortDescription,
        coverImage,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        startTime,
        endTime,
        timezone: timezone || 'UTC',
        venueId: effectiveVenueId || null,
        venueName: effectiveVenueName,
        venueAddress: effectiveVenueAddress,
        venueCity: effectiveVenueCity,
        venueState: effectiveVenueState,
        venueCountry: effectiveVenueCountry || 'GH',
        venueLat: effectiveVenueLat,
        venueLng: effectiveVenueLng,
        isVirtual: isVirtual || false,
        virtualUrl,
        capacity,
        status: 'DRAFT',
        isFeatured: isFeatured || false,
        isPaid: isPaid || false,
        currency: currency || 'USD',
        organizerId: user.id,
        categoryId,
      },
      include: {
        category: true,
        ticketTypes: true,
        organizer: { select: { id: true, name: true, avatar: true } },
      },
    });

    // Create tags if provided
    if (tags && Array.isArray(tags) && tags.length > 0) {
      for (const tagName of tags) {
        const tagSlug = slugify(tagName);
        const tag = await db.tag.upsert({
          where: { slug: tagSlug },
          update: {},
          create: { name: tagName, slug: tagSlug },
        });
        await db.eventTag.create({
          data: { eventId: event.id, tagId: tag.id },
        });
      }
    }

    // Create ticket types if provided
    if (ticketTypes && Array.isArray(ticketTypes) && ticketTypes.length > 0) {
      for (const tt of ticketTypes) {
        await db.ticketType.create({
          data: {
            eventId: event.id,
            name: tt.name,
            description: tt.description,
            price: tt.price || 0,
            currency: currency || 'USD',
            quantity: tt.quantity || 100,
            minPerOrder: tt.minPerOrder || 1,
            maxPerOrder: tt.maxPerOrder || 10,
          },
        });
      }
    }

    const fullEvent = await db.event.findUnique({
      where: { id: event.id },
      include: {
        category: true,
        ticketTypes: true,
        organizer: { select: { id: true, name: true, avatar: true } },
        tags: { include: { tag: true } },
      },
    });

    return NextResponse.json({ event: fullEvent }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
