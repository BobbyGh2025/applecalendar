import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';
import { authorizeEventContent, verifyMediaBelongsToEvent } from '@/lib/services/event-content';
import { getEventUsage, requireWithinLimit, getOperableOrganizerEntitlements } from '@/lib/services/entitlements';
import { filterPublicMediaFields, isEventPubliclyVisible } from '@/lib/services/event-auth';

// ─── Validation Schemas ───

const VALID_MEDIA_TYPES = ['IMAGE', 'VIDEO', 'DOCUMENT'] as const;
const VALID_MEDIA_CATEGORIES = [
  'POSTER', 'COVER', 'GALLERY', 'PROMOTIONAL_VIDEO', 'DOCUMENT', 'PROGRAM',
] as const;

const createMediaSchema = z.object({
  url: z.string().url('A valid URL is required'),
  type: z.enum(VALID_MEDIA_TYPES),
  category: z.enum(VALID_MEDIA_CATEGORIES).default('GALLERY'),
  caption: z.string().max(500, 'Caption must be 500 characters or fewer').optional(),
  sortOrder: z.number().int().min(0).default(0),
  fileSize: z.number().int().min(0).optional(),
  mimeType: z.string().max(100).optional(),
});

const updateMediaSchema = z.object({
  url: z.string().url('A valid URL is required').optional(),
  type: z.enum(VALID_MEDIA_TYPES).optional(),
  category: z.enum(VALID_MEDIA_CATEGORIES).optional(),
  caption: z.string().max(500, 'Caption must be 500 characters or fewer').optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  fileSize: z.number().int().min(0).optional(),
  mimeType: z.string().max(100).optional(),
});

// ─── GET /api/events/:id/media ───

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await params;

    // Try to authenticate (optional — public access for published events)
    let authUser: { id: string; role: string } | null = null;
    try {
      authUser = await authenticate(request);
    } catch {
      // Not authenticated — public access
    }

    const event = await db.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });

    if (!event) {
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    }

    // Public users can only see media for publicly visible events
    const isPublicUser = !authUser || !['ORGANIZER', 'SUPER_ADMIN', 'STAFF'].includes(authUser.role);
    if (isPublicUser && !isEventPubliclyVisible(event.status)) {
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    }

    const media = await db.eventMedia.findMany({
      where: { eventId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // Phase 4F: Filter internal metadata for public users
    const publicMedia = isPublicUser
      ? media.map(m => filterPublicMediaFields(m))
      : media;

    return NextResponse.json({ media: publicMedia });
  } catch (error) {
    return handleApiError(error);
  }
}

// ─── POST /api/events/:id/media ───

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId } = await params;

    // Authorize: verify ownership + operable organizer + mutable event
    const { entitlements } = await authorizeEventContent(eventId, user.id, user.role, {
      requireMutableEvent: true,
    });

    const body = await request.json();
    const parsed = createMediaSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    // Phase 4D: Enforce maxMediaPerEvent entitlement limit
    // SUPER_ADMIN bypasses entitlement checks
    if (user.role !== 'SUPER_ADMIN' && entitlements) {
      const eventUsage = await getEventUsage(eventId);
      requireWithinLimit(
        eventUsage.media,
        entitlements.limits.maxMediaPerEvent,
        'media per event',
        entitlements.planSlug,
      );
    }

    const media = await db.eventMedia.create({
      data: {
        eventId,
        url: parsed.data.url,
        type: parsed.data.type,
        category: parsed.data.category,
        caption: parsed.data.caption,
        sortOrder: parsed.data.sortOrder,
        fileSize: parsed.data.fileSize,
        mimeType: parsed.data.mimeType,
        uploadedBy: user.id,
      },
    });

    return NextResponse.json({ media }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

// ─── PATCH /api/events/:id/media?mediaId=xxx ───
// Individual media update via query parameter (see Section 9 — filesystem
// limitation prevents creating a Next.js dynamic route segment [mediaId]).

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId } = await params;

    const { searchParams } = new URL(request.url);
    const mediaId = searchParams.get('mediaId');
    if (!mediaId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'mediaId query parameter is required for PATCH');
    }

    // Authorize: verify ownership + operable organizer + mutable event
    await authorizeEventContent(eventId, user.id, user.role, {
      requireMutableEvent: true,
    });

    // Verify media belongs to this event
    await verifyMediaBelongsToEvent(mediaId, eventId);

    const body = await request.json();
    const parsed = updateMediaSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (parsed.data.url !== undefined) updateData.url = parsed.data.url;
    if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
    if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
    if (parsed.data.caption !== undefined) updateData.caption = parsed.data.caption;
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.fileSize !== undefined) updateData.fileSize = parsed.data.fileSize;
    if (parsed.data.mimeType !== undefined) updateData.mimeType = parsed.data.mimeType;

    const media = await db.eventMedia.update({
      where: { id: mediaId },
      data: updateData,
    });

    return NextResponse.json({ media });
  } catch (error) {
    return handleApiError(error);
  }
}

// ─── DELETE /api/events/:id/media?mediaId=xxx ───
// Individual media deletion via query parameter.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId } = await params;

    const { searchParams } = new URL(request.url);
    const mediaId = searchParams.get('mediaId');
    if (!mediaId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'mediaId query parameter is required for DELETE');
    }

    // Authorize: verify ownership + operable organizer + mutable event
    await authorizeEventContent(eventId, user.id, user.role, {
      requireMutableEvent: true,
    });

    // Verify media belongs to this event
    await verifyMediaBelongsToEvent(mediaId, eventId);

    // Delete media (no financial records depend on media)
    await db.eventMedia.delete({
      where: { id: mediaId },
    });

    return NextResponse.json({
      success: true,
      message: 'Media deleted successfully',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
