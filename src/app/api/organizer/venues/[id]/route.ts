import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { updateVenueSchema } from '@/lib/validations';
import { authorizeVenueAccess, checkVenueUsage, VENUE_ERRORS } from '@/lib/services/venue-auth';
import { getOperableOrganizerEntitlements } from '@/lib/services/entitlements';

import { slugify } from '@/lib/utils/slugify';

/**
 * GET /api/organizer/venues/:id
 * Get a single venue by ID. Requires ownership or SUPER_ADMIN.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN', 'STAFF')(user);
    const { id } = await params;

    const { venue } = await authorizeVenueAccess(id, user.id, user.role, {
      adminBypass: true,
      requireManage: false,
    });

    // Fetch full venue details
    const fullVenue = await db.venue.findUnique({
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
        isPublic: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { events: true, sessions: true },
        },
      },
    });

    if (!fullVenue) {
      throw new ApiError(404, VENUE_ERRORS.VENUE_NOT_FOUND, 'Venue not found');
    }

    return NextResponse.json({ venue: fullVenue });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/organizer/venues/:id
 * Update a venue. Requires ownership and operable organizer.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);
    const { id } = await params;

    // Verify ownership and operability
    await authorizeVenueAccess(id, user.id, user.role, {
      adminBypass: true,
      requireManage: true,
    });

    // For organizers, verify operability
    if (user.role === 'ORGANIZER') {
      await getOperableOrganizerEntitlements(user.id);
    }

    const body = await request.json();
    const parsed = updateVenueSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const updateData: Record<string, unknown> = {};
    const data = parsed.data;

    if (data.name !== undefined) {
      updateData.name = data.name;
      updateData.slug = slugify(data.name);
    }
    if (data.description !== undefined) updateData.description = data.description;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;
    if (data.lat !== undefined) updateData.lat = data.lat;
    if (data.lng !== undefined) updateData.lng = data.lng;
    if (data.googleMapsUrl !== undefined) updateData.googleMapsUrl = data.googleMapsUrl || null;
    if (data.coverImage !== undefined) updateData.coverImage = data.coverImage || null;
    if (data.capacity !== undefined) updateData.capacity = data.capacity;
    if (data.amenities !== undefined) updateData.amenities = JSON.stringify(data.amenities);
    if (data.contactName !== undefined) updateData.contactName = data.contactName;
    if (data.contactEmail !== undefined) updateData.contactEmail = data.contactEmail || null;
    if (data.contactPhone !== undefined) updateData.contactPhone = data.contactPhone;
    if (data.website !== undefined) updateData.website = data.website || null;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    // Ensure slug uniqueness if name changed
    if (updateData.slug) {
      const existingSlug = await db.venue.findFirst({
        where: { slug: updateData.slug as string, NOT: { id } },
      });
      if (existingSlug) {
        updateData.slug = `${updateData.slug}-${Date.now()}`;
      }
    }

    const venue = await db.venue.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ venue });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/organizer/venues/:id
 * Delete a venue. Prevents deletion if venue is assigned to events.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);
    const { id } = await params;

    // Verify ownership and operability
    await authorizeVenueAccess(id, user.id, user.role, {
      adminBypass: true,
      requireManage: true,
    });

    // For organizers, verify operability
    if (user.role === 'ORGANIZER') {
      await getOperableOrganizerEntitlements(user.id);
    }

    // Check if venue is in use
    const usage = await checkVenueUsage(id);
    if (usage.eventCount > 0 || usage.sessionCount > 0) {
      throw new ApiError(
        409,
        VENUE_ERRORS.VENUE_IN_USE,
        `Cannot delete venue: it is assigned to ${usage.eventCount} event(s) and ${usage.sessionCount} session(s). Remove the venue from events before deleting.`,
        { eventCount: usage.eventCount, sessionCount: usage.sessionCount },
      );
    }

    await db.venue.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: 'Venue deleted successfully',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
