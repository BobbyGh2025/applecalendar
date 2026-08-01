import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole, AuthError } from '@/lib/auth';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const event = await db.event.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true, icon: true, color: true } },
        ticketTypes: {
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            currency: true,
            quantity: true,
            soldCount: true,
            minPerOrder: true,
            maxPerOrder: true,
            saleStart: true,
            saleEnd: true,
            isActive: true,
          },
        },
        organizer: { select: { id: true, name: true, avatar: true, bio: true } },
        reviews: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
        },
        tags: { include: { tag: true } },
        _count: { select: { bookings: true } },
      },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json({ event });
  } catch (error) {
    console.error('Event GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id } = await params;

    const existingEvent = await db.event.findUnique({ where: { id } });
    if (!existingEvent) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only owner or admin can update
    if (existingEvent.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'You do not have permission to update this event' }, { status: 403 });
    }

    const body = await request.json();
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
      status,
      tags,
    } = body;

    const updateData: Record<string, unknown> = {};

    if (title !== undefined) {
      updateData.title = title;
      updateData.slug = slugify(title);
    }
    if (description !== undefined) updateData.description = description;
    if (shortDescription !== undefined) updateData.shortDescription = shortDescription;
    if (coverImage !== undefined) updateData.coverImage = coverImage;
    if (startDate !== undefined) updateData.startDate = new Date(startDate);
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (startTime !== undefined) updateData.startTime = startTime;
    if (endTime !== undefined) updateData.endTime = endTime;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (venueName !== undefined) updateData.venueName = venueName;
    if (venueAddress !== undefined) updateData.venueAddress = venueAddress;
    if (venueCity !== undefined) updateData.venueCity = venueCity;
    if (venueState !== undefined) updateData.venueState = venueState;
    if (venueCountry !== undefined) updateData.venueCountry = venueCountry;
    if (venueLat !== undefined) updateData.venueLat = venueLat;
    if (venueLng !== undefined) updateData.venueLng = venueLng;
    if (isVirtual !== undefined) updateData.isVirtual = isVirtual;
    if (virtualUrl !== undefined) updateData.virtualUrl = virtualUrl;
    if (capacity !== undefined) updateData.capacity = capacity;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
    if (isPaid !== undefined) updateData.isPaid = isPaid;
    if (currency !== undefined) updateData.currency = currency;
    if (status !== undefined && (user.role === 'SUPER_ADMIN' || user.id === existingEvent.organizerId)) {
      updateData.status = status;
    }

    // Ensure slug uniqueness if title changed
    if (updateData.slug) {
      const existingSlug = await db.event.findFirst({ where: { slug: updateData.slug as string, NOT: { id } } });
      if (existingSlug) {
        updateData.slug = `${updateData.slug}-${Date.now()}`;
      }
    }

    const event = await db.event.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
        ticketTypes: true,
        organizer: { select: { id: true, name: true, avatar: true } },
        tags: { include: { tag: true } },
      },
    });

    // Update tags if provided
    if (tags !== undefined) {
      // Remove existing tags
      await db.eventTag.deleteMany({ where: { eventId: id } });
      // Add new tags
      if (Array.isArray(tags) && tags.length > 0) {
        for (const tagName of tags) {
          const tagSlug = slugify(tagName);
          const tag = await db.tag.upsert({
            where: { slug: tagSlug },
            update: {},
            create: { name: tagName, slug: tagSlug },
          });
          await db.eventTag.create({
            data: { eventId: id, tagId: tag.id },
          });
        }
      }
    }

    const fullEvent = await db.event.findUnique({
      where: { id },
      include: {
        category: true,
        ticketTypes: true,
        organizer: { select: { id: true, name: true, avatar: true } },
        tags: { include: { tag: true } },
      },
    });

    return NextResponse.json({ event: fullEvent });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Event PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id } = await params;

    const existingEvent = await db.event.findUnique({ where: { id } });
    if (!existingEvent) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (existingEvent.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'You do not have permission to delete this event' }, { status: 403 });
    }

    await db.event.delete({ where: { id } });

    return NextResponse.json({ message: 'Event deleted successfully' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Event DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
