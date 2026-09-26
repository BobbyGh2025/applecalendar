/**
 * Phase 4D: Event Content Authorization Helpers
 *
 * Shared utilities for verifying event ownership and operability
 * across all event content APIs (sessions, participants, media).
 *
 * These helpers enforce the ownership chain:
 *   Authenticated User → OrganizerProfile/Membership → Event → Session/Participant/Media
 */

import { db } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { getOperableOrganizerEntitlements, OrganizerEntitlements } from '@/lib/services/entitlements';

/** Error codes for event content operations */
export const EVENT_CONTENT_ERRORS = {
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  PARTICIPANT_NOT_FOUND: 'PARTICIPANT_NOT_FOUND',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  ORGANIZER_NOT_OPERABLE: 'ORGANIZER_NOT_OPERABLE',
  FORBIDDEN: 'FORBIDDEN',
  EVENT_CANCELLED: 'EVENT_CANCELLED',
  CROSS_EVENT_REFERENCE: 'CROSS_EVENT_REFERENCE',
} as const;

/**
 * Verify that the authenticated user owns (or has permission to manage) an event,
 * and that the organizer is operable.
 *
 * Returns the event and entitlements if authorized.
 * Throws ApiError if not authorized or organizer not operable.
 *
 * @param eventId - The event ID from the URL
 * @param userId - The authenticated user's ID
 * @param userRole - The authenticated user's role
 * @param options - Additional options
 */
export async function authorizeEventContent(
  eventId: string,
  userId: string,
  userRole: string,
  options: {
    /** If true, allow SUPER_ADMIN to bypass operability check */
    adminBypass?: boolean;
    /** If true, also check that the event is not CANCELLED */
    requireMutableEvent?: boolean;
  } = {},
): Promise<{
  event: {
    id: string;
    organizerId: string;
    status: string;
    title: string;
  };
  entitlements: OrganizerEntitlements | null;
}> {
  const { adminBypass = true, requireMutableEvent = true } = options;

  // 1. Load the event
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, organizerId: true, status: true, title: true },
  });

  if (!event) {
    throw new ApiError(404, EVENT_CONTENT_ERRORS.EVENT_NOT_FOUND, 'Event not found');
  }

  // 2. Verify ownership
  const isOwner = event.organizerId === userId;
  const isAdmin = userRole === 'SUPER_ADMIN';

  if (!isOwner && !isAdmin) {
    // Check membership-based authorization
    const eventOwner = await db.user.findUnique({
      where: { id: event.organizerId },
      select: { organizerProfile: { select: { id: true } } },
    });

    let hasPermission = false;
    if (eventOwner?.organizerProfile) {
      const membership = await db.organizerMembership.findUnique({
        where: { organizerId_userId: { organizerId: eventOwner.organizerProfile.id, userId } },
      });
      if (membership && membership.status === 'ACTIVE') {
        // Members with events.update permission can manage content
        const perms = JSON.parse(membership.permissions || '[]');
        hasPermission = perms.includes('events.update');
      }
    }

    if (!hasPermission) {
      throw new ApiError(403, EVENT_CONTENT_ERRORS.FORBIDDEN, 'You do not have permission to manage this event\'s content');
    }
  }

  // 3. Check organizer operability (SUPER_ADMIN bypasses)
  let entitlements: OrganizerEntitlements | null = null;

  if (!isAdmin || !adminBypass) {
    // For organizers, verify they are operable
    const eventOwnerUser = await db.user.findUnique({
      where: { id: event.organizerId },
      select: { role: true },
    });

    if (eventOwnerUser?.role === 'ORGANIZER') {
      entitlements = await getOperableOrganizerEntitlements(event.organizerId);
    }
  }

  // 4. Check event mutability
  if (requireMutableEvent && event.status === 'CANCELLED') {
    throw new ApiError(409, EVENT_CONTENT_ERRORS.EVENT_CANCELLED, 'Cannot modify content of a cancelled event');
  }

  return { event, entitlements };
}

/**
 * Verify that a session belongs to the specified event.
 * Prevents cross-event session references.
 */
export async function verifySessionBelongsToEvent(
  sessionId: string,
  eventId: string,
): Promise<{
  id: string;
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  date: Date | null;
  sortOrder: number;
  sessionType: string;
  status: string;
  participantId: string | null;
  venueId: string | null;
  venueName: string | null;
  description: string | null;
}> {
  const session = await db.eventSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      eventId: true,
      title: true,
      startTime: true,
      endTime: true,
      date: true,
      sortOrder: true,
      sessionType: true,
      status: true,
      participantId: true,
      venueId: true,
      venueName: true,
      description: true,
    },
  });

  if (!session) {
    throw new ApiError(404, EVENT_CONTENT_ERRORS.SESSION_NOT_FOUND, 'Session not found');
  }

  if (session.eventId !== eventId) {
    throw new ApiError(403, EVENT_CONTENT_ERRORS.CROSS_EVENT_REFERENCE, 'Session does not belong to this event');
  }

  return session;
}

/**
 * Verify that a participant belongs to the specified event.
 * Prevents cross-event participant references.
 */
export async function verifyParticipantBelongsToEvent(
  participantId: string,
  eventId: string,
): Promise<{
  id: string;
  eventId: string;
  name: string;
  role: string;
  bio: string | null;
  image: string | null;
  title: string | null;
  organization: string | null;
  socialLinks: string | null;
  email: string | null;
  sortOrder: number;
  isFeatured: boolean;
}> {
  const participant = await db.eventParticipant.findUnique({
    where: { id: participantId },
    select: {
      id: true,
      eventId: true,
      name: true,
      role: true,
      bio: true,
      image: true,
      title: true,
      organization: true,
      socialLinks: true,
      email: true,
      sortOrder: true,
      isFeatured: true,
    },
  });

  if (!participant) {
    throw new ApiError(404, EVENT_CONTENT_ERRORS.PARTICIPANT_NOT_FOUND, 'Participant not found');
  }

  if (participant.eventId !== eventId) {
    throw new ApiError(403, EVENT_CONTENT_ERRORS.CROSS_EVENT_REFERENCE, 'Participant does not belong to this event');
  }

  return participant;
}

/**
 * Verify that media belongs to the specified event.
 * Prevents cross-event media references.
 */
export async function verifyMediaBelongsToEvent(
  mediaId: string,
  eventId: string,
): Promise<{
  id: string;
  eventId: string;
  url: string;
  type: string;
  category: string;
  caption: string | null;
  sortOrder: number;
  fileSize: number | null;
  mimeType: string | null;
  uploadedBy: string;
}> {
  const media = await db.eventMedia.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      eventId: true,
      url: true,
      type: true,
      category: true,
      caption: true,
      sortOrder: true,
      fileSize: true,
      mimeType: true,
      uploadedBy: true,
    },
  });

  if (!media) {
    throw new ApiError(404, EVENT_CONTENT_ERRORS.MEDIA_NOT_FOUND, 'Media not found');
  }

  if (media.eventId !== eventId) {
    throw new ApiError(403, EVENT_CONTENT_ERRORS.CROSS_EVENT_REFERENCE, 'Media does not belong to this event');
  }

  return media;
}

/**
 * Verify that a participant ID (if provided) belongs to the same event.
 * Used when creating/updating sessions that reference a participant.
 */
export async function verifyParticipantInSameEvent(
  participantId: string | null | undefined,
  eventId: string,
): Promise<void> {
  if (!participantId) return;

  const participant = await db.eventParticipant.findUnique({
    where: { id: participantId },
    select: { eventId: true },
  });

  if (!participant) {
    throw new ApiError(404, EVENT_CONTENT_ERRORS.PARTICIPANT_NOT_FOUND, 'Referenced participant not found');
  }

  if (participant.eventId !== eventId) {
    throw new ApiError(403, EVENT_CONTENT_ERRORS.CROSS_EVENT_REFERENCE, 'Cannot reference a participant from another event');
  }
}
