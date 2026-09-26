import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';
import { authorizeEventContent, verifyParticipantInSameEvent } from '@/lib/services/event-content';

// ─── Validation Schemas ───

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createSessionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or fewer'),
  description: z.string().max(2000, 'Description must be 2000 characters or fewer').optional(),
  startTime: z.string().regex(TIME_REGEX, 'Start time must be HH:MM format'),
  endTime: z.string().regex(TIME_REGEX, 'End time must be HH:MM format'),
  date: z.string().optional(), // ISO date string for multi-day events
  sortOrder: z.number().int().min(0).default(0),
  venueId: z.string().optional(),
  venueName: z.string().max(200).optional(),
  participantId: z.string().optional(), // FK → EventParticipant (speaker/artist)
  sessionType: z.enum([
    'SESSION', 'BREAK', 'REGISTRATION', 'KEYNOTE',
    'PANEL', 'WORKSHOP', 'ENTERTAINMENT',
  ]).default('SESSION'),
  status: z.enum(['SCHEDULED', 'CANCELLED']).default('SCHEDULED'),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: 'Start time must be before end time', path: ['startTime'] },
);

const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  startTime: z.string().regex(TIME_REGEX, 'Start time must be HH:MM format').optional(),
  endTime: z.string().regex(TIME_REGEX, 'End time must be HH:MM format').optional(),
  date: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  venueId: z.string().optional().nullable(),
  venueName: z.string().max(200).optional().nullable(),
  participantId: z.string().optional().nullable(),
  sessionType: z.enum([
    'SESSION', 'BREAK', 'REGISTRATION', 'KEYNOTE',
    'PANEL', 'WORKSHOP', 'ENTERTAINMENT',
  ]).optional(),
  status: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
});

// ─── GET /api/events/:id/sessions ───

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
      select: { id: true, status: true, organizerId: true },
    });

    if (!event) {
      throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
    }

    // Public users can only see sessions for PUBLISHED events
    if (!authUser || !['ORGANIZER', 'SUPER_ADMIN', 'STAFF'].includes(authUser.role)) {
      if (event.status !== 'PUBLISHED') {
        throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event not found');
      }
    }

    const sessions = await db.eventSession.findMany({
      where: { eventId },
      orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }, { startTime: 'asc' }],
      include: {
        participant: {
          select: { id: true, name: true, role: true, image: true },
        },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    return handleApiError(error);
  }
}

// ─── POST /api/events/:id/sessions ───

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
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    // Verify participant belongs to same event (if referenced)
    await verifyParticipantInSameEvent(parsed.data.participantId, eventId);

    const session = await db.eventSession.create({
      data: {
        eventId,
        title: parsed.data.title,
        description: parsed.data.description,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        date: parsed.data.date ? new Date(parsed.data.date) : null,
        sortOrder: parsed.data.sortOrder,
        venueId: parsed.data.venueId,
        venueName: parsed.data.venueName,
        participantId: parsed.data.participantId,
        sessionType: parsed.data.sessionType,
        status: parsed.data.status,
      },
      include: {
        participant: {
          select: { id: true, name: true, role: true, image: true },
        },
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
