import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { updateEventSchema } from '@/lib/validations';
import { PERMISSIONS, hasPermission, getOrganizerPermissions } from '@/lib/permissions';
import { verifyVenueAssignment } from '@/lib/services/venue-auth';

import { slugify } from '@/lib/utils/slugify';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Try to authenticate (optional — may fail for public users)
    let authenticatedUser: { id: string; role: string } | null = null;
    try {
      authenticatedUser = await authenticate(request);
    } catch {
      // User is unauthenticated — that's fine for GET
    }

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
        // Phase 4E: Include venue relation in event detail
        venue: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true,
            country: true,
            lat: true,
            lng: true,
            googleMapsUrl: true,
            coverImage: true,
            capacity: true,
            website: true,
            isPublic: true,
            slug: true,
          },
        },
        // Phase 4D: Include sessions, participants, and media in event detail
        sessions: {
          where: { status: 'SCHEDULED' },
          orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }, { startTime: 'asc' }],
          include: {
            participant: { select: { id: true, name: true, role: true, image: true } },
          },
        },
        participants: {
          orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            bio: true,
            image: true,
            role: true,
            title: true,
            organization: true,
            isFeatured: true,
            _count: { select: { sessions: true } },
          },
        },
        media: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        _count: { select: { bookings: true } },
      },
    });

    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    // Public/unauthenticated users can only see PUBLISHED events
    if ((!authenticatedUser || authenticatedUser.role === 'PUBLIC') && event.status !== 'PUBLISHED') {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    return NextResponse.json({ event });
  } catch (error) {
    return handleApiError(error);
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
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    // Only owner, admin, or staff with events.update permission can update
    if (existingEvent.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      // Check staff membership with events.update permission
      const eventOwner = await db.user.findUnique({
        where: { id: existingEvent.organizerId },
        select: { organizerProfile: { select: { id: true } } },
      });

      let hasUpdatePermission = false;
      if (eventOwner?.organizerProfile) {
        const membership = await db.organizerMembership.findUnique({
          where: { organizerId_userId: { organizerId: eventOwner.organizerProfile.id, userId: user.id } },
        });
        if (membership && membership.status === 'ACTIVE') {
          const perms = getOrganizerPermissions(membership);
          hasUpdatePermission = hasPermission(perms, PERMISSIONS.EVENTS_UPDATE);
        }
      }

      if (!hasUpdatePermission) {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to update this event');
      }
    }

    const body = await request.json();

    const parsed = updateEventSchema.safeParse(body);
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
      status,
      tags,
    } = parsed.data;

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

    // Phase 4E: Handle venueId assignment/change/removal
    if (venueId !== undefined) {
      if (venueId === '') {
        // Empty string = remove venue association
        updateData.venueId = null;
      } else {
        // Verify the venue belongs to this organizer
        const venueInfo = await verifyVenueAssignment(venueId, existingEvent.organizerId, user.role);
        updateData.venueId = venueId;
        // Auto-populate inline venue fields from the venue record
        updateData.venueName = venueInfo.name;
        updateData.venueAddress = venueInfo.address;
        updateData.venueCity = venueInfo.city;
        updateData.venueState = venueInfo.state;
        updateData.venueCountry = venueInfo.country;
        updateData.venueLat = venueInfo.lat;
        updateData.venueLng = venueInfo.lng;
      }
    }

    // Inline venue fields only updated if venueId is NOT being set (to avoid overwriting venue-sourced data)
    if (venueId === undefined) {
      if (venueName !== undefined) updateData.venueName = venueName;
      if (venueAddress !== undefined) updateData.venueAddress = venueAddress;
      if (venueCity !== undefined) updateData.venueCity = venueCity;
      if (venueState !== undefined) updateData.venueState = venueState;
      if (venueCountry !== undefined) updateData.venueCountry = venueCountry;
      if (venueLat !== undefined) updateData.venueLat = venueLat;
      if (venueLng !== undefined) updateData.venueLng = venueLng;
    }
    if (isVirtual !== undefined) updateData.isVirtual = isVirtual;
    if (virtualUrl !== undefined) updateData.virtualUrl = virtualUrl;
    if (capacity !== undefined) updateData.capacity = capacity;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (isFeatured !== undefined && user.role === 'SUPER_ADMIN') updateData.isFeatured = isFeatured;
    if (isPaid !== undefined) updateData.isPaid = isPaid;
    if (currency !== undefined) updateData.currency = currency;
    // Status transition validation — enforced server-side
    if (status !== undefined) {
      const currentStatus = existingEvent.status;
      const isOwner = user.id === existingEvent.organizerId;
      const isAdmin = user.role === 'SUPER_ADMIN';

      // SUPER_ADMIN may perform any status transition (administrative bypass)
      if (isAdmin) {
        updateData.status = status;
      } else if (isOwner) {
        // Organizers may only perform these safe transitions:
        // DRAFT → PENDING (submit for review)
        // PENDING → DRAFT (withdraw from review)
        // PUBLISHED → CANCELLED (cancel published event)
        const allowedTransitions: Record<string, string[]> = {
          DRAFT: ['PENDING'],
          PENDING: ['DRAFT'],
          PUBLISHED: ['CANCELLED'],
        };
        const allowed = allowedTransitions[currentStatus];
        if (!allowed || !allowed.includes(status)) {
          throw new ApiError(
            403,
            'FORBIDDEN',
            `Organizers cannot transition event status from ${currentStatus} to ${status}`
          );
        }
        updateData.status = status;
      } else {
        // Non-owner, non-admin cannot change status
        throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to change this event\'s status');
      }
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
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id } = await params;

    const existingEvent = await db.event.findUnique({
      where: { id },
      include: {
        ticketTypes: { select: { soldCount: true } },
        _count: { select: { bookings: true } },
      },
    });
    if (!existingEvent) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    if (existingEvent.organizerId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to delete this event');
    }

    // ─── Event Delete Safety ───
    // If the event has any bookings or sold tickets, we must NOT hard-delete
    // because that would destroy transactional records (bookings, tickets, payments).
    // Instead, set the event status to CANCELLED (soft-delete).
    const hasBookings = existingEvent._count.bookings > 0;
    const hasSoldTickets = existingEvent.ticketTypes.some(tt => tt.soldCount > 0);

    if (hasBookings || hasSoldTickets) {
      // Soft-delete: set status to CANCELLED to preserve transactional history
      if (existingEvent.status !== 'CANCELLED') {
        await db.event.update({
          where: { id },
          data: { status: 'CANCELLED', isBookable: false },
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Event has existing bookings or sold tickets. Event has been cancelled to preserve transactional records. It was not permanently deleted.',
        softDeleted: true,
      });
    }

    // No transactional records exist — safe to hard-delete
    await db.event.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: 'Event deleted successfully',
      softDeleted: false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
