import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';
import { authorizeEventContent } from '@/lib/services/event-content';

// ─── Validation Schemas ───

const VALID_PARTICIPANT_ROLES = [
  'SPEAKER', 'ARTIST', 'PERFORMER', 'MODERATOR',
  'PANELIST', 'DJ', 'HOST', 'INSTRUCTOR',
] as const;

const createParticipantSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
  bio: z.string().max(5000, 'Bio must be 5000 characters or fewer').optional(),
  image: z.string().max(500, 'Image URL too long').optional(),
  role: z.enum(VALID_PARTICIPANT_ROLES).default('SPEAKER'),
  title: z.string().max(200, 'Title must be 200 characters or fewer').optional(),
  organization: z.string().max(200, 'Organization must be 200 characters or fewer').optional(),
  socialLinks: z.string().max(2000, 'Social links too long').optional(), // JSON string
  email: z.string().email('Invalid email format').optional(),
  sortOrder: z.number().int().min(0).default(0),
  isFeatured: z.boolean().default(false),
});

const updateParticipantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  bio: z.string().max(5000).optional().nullable(),
  image: z.string().max(500).optional().nullable(),
  role: z.enum(VALID_PARTICIPANT_ROLES).optional(),
  title: z.string().max(200).optional().nullable(),
  organization: z.string().max(200).optional().nullable(),
  socialLinks: z.string().max(2000).optional().nullable(),
  email: z.string().email('Invalid email format').optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isFeatured: z.boolean().optional(),
});

// ─── GET /api/events/:id/participants ───

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

    // Public users can only see participants for PUBLISHED events
    if (!authUser || !['ORGANIZER', 'SUPER_ADMIN', 'STAFF'].includes(authUser.role)) {
      if (event.status !== 'PUBLISHED') {
        throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
      }
    }

    // For public/unauthenticated: omit email (private field)
    const isOrganizerOrAdmin = authUser && ['ORGANIZER', 'SUPER_ADMIN', 'STAFF'].includes(authUser.role);

    const participants = await db.eventParticipant.findMany({
      where: { eventId },
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        bio: true,
        image: true,
        role: true,
        title: true,
        organization: true,
        socialLinks: isOrganizerOrAdmin ? true : false,
        email: isOrganizerOrAdmin ? true : false,
        sortOrder: true,
        isFeatured: true,
        _count: {
          select: { sessions: true },
        },
      },
    });

    return NextResponse.json({ participants });
  } catch (error) {
    return handleApiError(error);
  }
}

// ─── POST /api/events/:id/participants ───

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId } = await params;

    // Authorize: verify ownership + operable organizer + mutable event
    await authorizeEventContent(eventId, user.id, user.role, {
      requireMutableEvent: true,
    });

    const body = await request.json();
    const parsed = createParticipantSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    // Validate socialLinks is valid JSON if provided
    if (parsed.data.socialLinks) {
      try {
        JSON.parse(parsed.data.socialLinks);
      } catch {
        throw new ApiError(422, 'VALIDATION_ERROR', 'socialLinks must be a valid JSON string');
      }
    }

    const participant = await db.eventParticipant.create({
      data: {
        eventId,
        name: parsed.data.name,
        bio: parsed.data.bio,
        image: parsed.data.image,
        role: parsed.data.role,
        title: parsed.data.title,
        organization: parsed.data.organization,
        socialLinks: parsed.data.socialLinks,
        email: parsed.data.email,
        sortOrder: parsed.data.sortOrder,
        isFeatured: parsed.data.isFeatured,
      },
    });

    return NextResponse.json({ participant }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
