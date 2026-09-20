import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { createEventSchema, eventQuerySchema } from '@/lib/validations';
import { getOperableOrganizerEntitlements, getOrganizerUsage, requireWithinLimit } from '@/lib/services/entitlements';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

    const { page, limit, search = '', category, date, featured, status } = parsed.data;

    // Check if user is authenticated (optional)
    let authUser: { id: string; role: string } | null = null;
    try {
      authUser = await authenticate(request);
    } catch {
      // Not authenticated — public access
    }

    const where: Record<string, unknown> = {};

    // Public users only see PUBLISHED events (unless they are organizer/admin)
    if (!authUser || !['ORGANIZER', 'SUPER_ADMIN', 'STAFF'].includes(authUser.role)) {
      where.status = 'PUBLISHED';
    } else if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
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
          _count: { select: { reviews: true, bookings: true } },
        },
      }),
      db.event.count({ where }),
    ]);

    return NextResponse.json({
      events,
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
        venueName,
        venueAddress,
        venueCity,
        venueState,
        venueCountry: venueCountry || 'US',
        venueLat,
        venueLng,
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
