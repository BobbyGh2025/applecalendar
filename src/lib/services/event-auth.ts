/**
 * Phase 4F: Public Event Authorization & Field Filtering
 *
 * Provides field filtering for public event API consumers,
 * following the pattern established by venue-auth.ts (Phase 4E).
 *
 * Public users must NOT see:
 * - Event: contactEmail, contactPhone, rejectionReason, moderatedBy, moderatedAt, visibility (internal)
 * - Participant: email, socialLinks (private organizer communication)
 * - Media: uploadedBy, fileSize, mimeType (internal metadata)
 *
 * Event visibility rules (uses existing event lifecycle):
 * - PUBLISHED: Visible to public
 * - CANCELLED: Visible to public (with status message)
 * - COMPLETED: Visible to public (with status message)
 * - DRAFT: Not visible to public
 * - PENDING: Not visible to public
 * - REJECTED: Not visible to public
 */

/** Event statuses that are visible to unauthenticated public users */
export const PUBLICLY_VISIBLE_STATUSES = ['PUBLISHED', 'CANCELLED', 'COMPLETED'] as const;

/** Event statuses that are hidden from public users */
export const PRIVATE_STATUSES = ['DRAFT', 'PENDING', 'REJECTED'] as const;

/**
 * Check if an event status is publicly visible.
 * Uses the existing centralized event status rules — no new visibility system.
 */
export function isEventPubliclyVisible(status: string): boolean {
  return PUBLICLY_VISIBLE_STATUSES.includes(status as any);
}

/**
 * Filter private fields from an event object for public consumption.
 *
 * Strips:
 * - contactEmail (organizer-private)
 * - contactPhone (organizer-private)
 * - rejectionReason (internal moderation)
 * - moderatedBy (internal moderation)
 * - moderatedAt (internal moderation)
 * - visibility (internal; public users see PUBLISHED events only)
 * - organizerId (internal; use organizer relation instead)
 *
 * Preserves all other fields including status (for CANCELLED/COMPLETED messaging).
 */
export function filterPublicEventFields<T extends Record<string, unknown>>(event: T): Omit<T, 'contactEmail' | 'contactPhone' | 'rejectionReason' | 'moderatedBy' | 'moderatedAt' | 'visibility' | 'organizerId'> {
  const {
    contactEmail,
    contactPhone,
    rejectionReason,
    moderatedBy,
    moderatedAt,
    visibility,
    organizerId,
    ...publicFields
  } = event;

  return publicFields as any;
}

/**
 * Filter private fields from a participant object for public consumption.
 *
 * Strips:
 * - email (private — for organizer communication only)
 * - socialLinks (private — contains personal social media)
 *
 * Display only public-safe fields:
 * - name, image, bio, role, title, organization, isFeatured, sortOrder
 */
export function filterPublicParticipantFields<T extends Record<string, unknown>>(participant: T): Omit<T, 'email' | 'socialLinks'> {
  const {
    email,
    socialLinks,
    ...publicFields
  } = participant;

  return publicFields as any;
}

/**
 * Filter private fields from a media object for public consumption.
 *
 * Strips:
 * - uploadedBy (internal — references User who uploaded, not public info)
 * - fileSize (internal metadata)
 * - mimeType (internal metadata)
 *
 * Display only public-safe fields:
 * - id, url, type, category, caption, sortOrder
 */
export function filterPublicMediaFields<T extends Record<string, unknown>>(media: T): Omit<T, 'uploadedBy' | 'fileSize' | 'mimeType'> {
  const {
    uploadedBy,
    fileSize,
    mimeType,
    ...publicFields
  } = media;

  return publicFields as any;
}

/**
 * Check if a booking action should be allowed for a given event.
 *
 * Booking is NOT allowed when:
 * - Event status is CANCELLED
 * - Event isBookable is false
 * - Event status is not PUBLISHED (only published events accept bookings)
 *
 * Returns { canBook: boolean, reason: string | null }
 */
export function getBookabilityStatus(event: {
  status: string;
  isBookable: boolean;
}): { canBook: boolean; reason: string | null } {
  if (event.status === 'CANCELLED') {
    return { canBook: false, reason: 'This event has been cancelled' };
  }

  if (event.status === 'COMPLETED') {
    return { canBook: false, reason: 'This event has already taken place' };
  }

  if (event.status !== 'PUBLISHED') {
    return { canBook: false, reason: 'This event is not currently available for booking' };
  }

  if (!event.isBookable) {
    return { canBook: false, reason: 'Booking is currently unavailable for this event' };
  }

  return { canBook: true, reason: null };
}
