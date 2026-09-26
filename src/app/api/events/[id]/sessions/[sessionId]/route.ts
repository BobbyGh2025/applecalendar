import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';
import { authorizeEventContent, verifySessionBelongsToEvent, verifyParticipantInSameEvent } from '@/lib/services/event-content';

// ─── Validation Schema ───

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
}).refine(
  (data) => {
    // Only validate time order if both are provided
    if (data.startTime && data.endTime) {
      return data.startTime < data.endTime;
    }
    return true;
  },
  { message: 'Start time must be before end time', path: ['startTime'] },
);

// ─── PATCH /api/events/:id/sessions/:sessionId ───

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId, sessionId } = await params;

    // Authorize: verify ownership + operable organizer + mutable event
    await authorizeEventContent(eventId, user.id, user.role, {
      requireMutableEvent: true,
    });

    // Verify session belongs to this event
    await verifySessionBelongsToEvent(sessionId, eventId);

    const body = await request.json();
    const parsed = updateSessionSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    // Verify participant belongs to same event (if referenced)
    await verifyParticipantInSameEvent(parsed.data.participantId, eventId);

    // Build update data (only include provided fields)
    const updateData: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.startTime !== undefined) updateData.startTime = parsed.data.startTime;
    if (parsed.data.endTime !== undefined) updateData.endTime = parsed.data.endTime;
    if (parsed.data.date !== undefined) updateData.date = parsed.data.date ? new Date(parsed.data.date) : null;
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.venueId !== undefined) updateData.venueId = parsed.data.venueId;
    if (parsed.data.venueName !== undefined) updateData.venueName = parsed.data.venueName;
    if (parsed.data.participantId !== undefined) updateData.participantId = parsed.data.participantId;
    if (parsed.data.sessionType !== undefined) updateData.sessionType = parsed.data.sessionType;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

    const session = await db.eventSession.update({
      where: { id: sessionId },
      data: updateData,
      include: {
        participant: {
          select: { id: true, name: true, role: true, image: true },
        },
      },
    });

    return NextResponse.json({ session });
  } catch (error) {
    return handleApiError(error);
  }
}

// ─── DELETE /api/events/:id/sessions/:sessionId ───

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId, sessionId } = await params;

    // Authorize: verify ownership + operable organizer + mutable event
    await authorizeEventContent(eventId, user.id, user.role, {
      requireMutableEvent: true,
    });

    // Verify session belongs to this event
    await verifySessionBelongsToEvent(sessionId, eventId);

    // Delete the session (cascade is safe — sessions don't have financial records)
    await db.eventSession.delete({
      where: { id: sessionId },
    });

    return NextResponse.json({
      success: true,
      message: 'Session deleted successfully',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
