import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';
import { authorizeEventContent, verifyParticipantBelongsToEvent } from '@/lib/services/event-content';

// ─── Validation Schema ───

const VALID_PARTICIPANT_ROLES = [
  'SPEAKER', 'ARTIST', 'PERFORMER', 'MODERATOR',
  'PANELIST', 'DJ', 'HOST', 'INSTRUCTOR',
] as const;

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

// ─── PATCH /api/events/:id/participants/:participantId ───

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; participantId: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId, participantId } = await params;

    // Authorize: verify ownership + operable organizer + mutable event
    await authorizeEventContent(eventId, user.id, user.role, {
      requireMutableEvent: true,
    });

    // Verify participant belongs to this event
    await verifyParticipantBelongsToEvent(participantId, eventId);

    const body = await request.json();
    const parsed = updateParticipantSchema.safeParse(body);
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

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.bio !== undefined) updateData.bio = parsed.data.bio;
    if (parsed.data.image !== undefined) updateData.image = parsed.data.image;
    if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.organization !== undefined) updateData.organization = parsed.data.organization;
    if (parsed.data.socialLinks !== undefined) updateData.socialLinks = parsed.data.socialLinks;
    if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.isFeatured !== undefined) updateData.isFeatured = parsed.data.isFeatured;

    const participant = await db.eventParticipant.update({
      where: { id: participantId },
      data: updateData,
    });

    return NextResponse.json({ participant });
  } catch (error) {
    return handleApiError(error);
  }
}

// ─── DELETE /api/events/:id/participants/:participantId ───

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; participantId: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId, participantId } = await params;

    // Authorize: verify ownership + operable organizer + mutable event
    await authorizeEventContent(eventId, user.id, user.role, {
      requireMutableEvent: true,
    });

    // Verify participant belongs to this event
    const participant = await verifyParticipantBelongsToEvent(participantId, eventId);

    // Check if any sessions reference this participant
    // Schema has SET semantics (EventSession.participantId is nullable),
    // so deleting the participant will detach it from sessions (set to null).
    // This is safe — no cascade to sessions.
    const sessionsReferencingParticipant = await db.eventSession.count({
      where: { participantId },
    });

    // Detach participant from sessions before deleting
    if (sessionsReferencingParticipant > 0) {
      await db.eventSession.updateMany({
        where: { participantId },
        data: { participantId: null },
      });
    }

    // Delete the participant
    await db.eventParticipant.delete({
      where: { id: participantId },
    });

    return NextResponse.json({
      success: true,
      message: 'Participant deleted successfully',
      detachedFromSessions: sessionsReferencingParticipant,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
