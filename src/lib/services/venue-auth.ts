/**
 * Phase 4E: Venue Authorization Helpers
 *
 * Shared utilities for verifying venue ownership and access
 * across all venue APIs (CRUD, event assignment).
 *
 * These helpers enforce the ownership chain:
 *   Authenticated User → OrganizerProfile/Membership → Venue
 *
 * A venue can be:
 * - Private (organizerId set): only the owning organizer can manage it
 * - Public (isPublic=true, organizerId may be null or set): visible to all,
 *   but only the owning organizer (or SUPER_ADMIN) can mutate it
 */

import { db } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { getOperableOrganizerEntitlements, OrganizerEntitlements } from '@/lib/services/entitlements';
import { PERMISSIONS, hasPermission, getOrganizerPermissions } from '@/lib/permissions';

/** Error codes for venue operations */
export const VENUE_ERRORS = {
  VENUE_NOT_FOUND: 'VENUE_NOT_FOUND',
  VENUE_IN_USE: 'VENUE_IN_USE',
  ORGANIZER_NOT_OPERABLE: 'ORGANIZER_NOT_OPERABLE',
  FORBIDDEN: 'FORBIDDEN',
  CROSS_ORGANIZER_VENUE: 'CROSS_ORGANIZER_VENUE',
  VENUE_ASSIGNMENT_FORBIDDEN: 'VENUE_ASSIGNMENT_FORBIDDEN',
} as const;

/**
 * Verify that the authenticated user owns (or has permission to manage) a venue,
 * and that the organizer is operable.
 *
 * Returns the venue and entitlements if authorized.
 * Throws ApiError if not authorized or organizer not operable.
 *
 * @param venueId - The venue ID
 * @param userId - The authenticated user's ID
 * @param userRole - The authenticated user's role
 * @param options - Additional options
 */
export async function authorizeVenueAccess(
  venueId: string,
  userId: string,
  userRole: string,
  options: {
    /** If true, allow SUPER_ADMIN to bypass operability check */
    adminBypass?: boolean;
    /** If true, require venues.manage permission (for mutations) */
    requireManage?: boolean;
  } = {},
): Promise<{
  venue: {
    id: string;
    name: string;
    organizerId: string | null;
    isPublic: boolean;
    slug: string;
  };
  entitlements: OrganizerEntitlements | null;
}> {
  const { adminBypass = true, requireManage = true } = options;

  // 1. Load the venue
  const venue = await db.venue.findUnique({
    where: { id: venueId },
    select: { id: true, name: true, organizerId: true, isPublic: true, slug: true },
  });

  if (!venue) {
    throw new ApiError(404, VENUE_ERRORS.VENUE_NOT_FOUND, 'Venue not found');
  }

  // 2. Verify ownership
  const isAdmin = userRole === 'SUPER_ADMIN';
  const isOwner = venue.organizerId === userId;

  if (!isOwner && !isAdmin) {
    // Check membership-based authorization
    // If the venue has an organizerId, check if the user is a member of that org
    if (venue.organizerId) {
      const venueOwner = await db.user.findUnique({
        where: { id: venue.organizerId },
        select: { organizerProfile: { select: { id: true } } },
      });

      let hasPermissionResult = false;
      if (venueOwner?.organizerProfile) {
        const membership = await db.organizerMembership.findUnique({
          where: { organizerId_userId: { organizerId: venueOwner.organizerProfile.id, userId } },
        });
        if (membership && membership.status === 'ACTIVE') {
          const perms = getOrganizerPermissions(membership);
          const requiredPerm = requireManage ? PERMISSIONS.VENUES_MANAGE : PERMISSIONS.VENUES_VIEW;
          hasPermissionResult = hasPermission(perms, requiredPerm);
        }
      }

      if (!hasPermissionResult) {
        throw new ApiError(403, VENUE_ERRORS.FORBIDDEN, 'You do not have permission to access this venue');
      }
    } else {
      // Venue has no organizerId (system/public venue) — only SUPER_ADMIN can manage
      throw new ApiError(403, VENUE_ERRORS.FORBIDDEN, 'You do not have permission to manage this venue');
    }
  }

  // 3. Check organizer operability (SUPER_ADMIN bypasses)
  let entitlements: OrganizerEntitlements | null = null;

  if (!isAdmin || !adminBypass) {
    // For the effective organizer, verify they are operable
    const effectiveOrganizerId = venue.organizerId || userId;
    const organizerUser = await db.user.findUnique({
      where: { id: effectiveOrganizerId },
      select: { role: true },
    });

    if (organizerUser?.role === 'ORGANIZER') {
      entitlements = await getOperableOrganizerEntitlements(effectiveOrganizerId);
    }
  }

  return { venue, entitlements };
}

/**
 * Verify that a venue can be assigned to an event owned by the given organizer.
 * Prevents cross-organizer venue assignment.
 *
 * Rules:
 * - If venue is public (isPublic=true) and has no organizerId, any organizer can use it
 * - If venue belongs to an organizer, only that organizer can assign it to their events
 * - SUPER_ADMIN can assign any venue
 */
export async function verifyVenueAssignment(
  venueId: string,
  eventOrganizerId: string,
  userRole: string,
): Promise<{
  id: string;
  name: string;
  address: string;
  city: string;
  state: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactName: string | null;
  description: string | null;
  googleMapsUrl: string | null;
  coverImage: string | null;
  amenities: string | null;
  postalCode: string | null;
  isPublic: boolean;
  organizerId: string | null;
}> {
  const venue = await db.venue.findUnique({
    where: { id: venueId },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      country: true,
      lat: true,
      lng: true,
      capacity: true,
      website: true,
      contactEmail: true,
      contactPhone: true,
      contactName: true,
      description: true,
      googleMapsUrl: true,
      coverImage: true,
      amenities: true,
      postalCode: true,
      isPublic: true,
      organizerId: true,
    },
  });

  if (!venue) {
    throw new ApiError(404, VENUE_ERRORS.VENUE_NOT_FOUND, 'Venue not found');
  }

  // SUPER_ADMIN can assign any venue
  if (userRole === 'SUPER_ADMIN') {
    return venue;
  }

  // If venue belongs to an organizer, only that organizer can assign it
  if (venue.organizerId && venue.organizerId !== eventOrganizerId) {
    throw new ApiError(
      403,
      VENUE_ERRORS.CROSS_ORGANIZER_VENUE,
      'Cannot assign a venue belonging to another organizer',
    );
  }

  // If venue has no organizerId (system venue), any authenticated organizer can use it
  // If venue belongs to this organizer, they can use it
  return venue;
}

/**
 * Check if a venue is currently assigned to any events.
 * Used before deletion to prevent broken references.
 */
export async function checkVenueUsage(venueId: string): Promise<{ eventCount: number; sessionCount: number }> {
  const [eventCount, sessionCount] = await Promise.all([
    db.event.count({ where: { venueId } }),
    db.eventSession.count({ where: { venueId } }),
  ]);
  return { eventCount, sessionCount };
}

/**
 * Resolve the organizer's userId for venue operations.
 * For ORGANIZER role, returns their own userId.
 * For SUPER_ADMIN, returns null (can operate on any venue).
 * For STAFF, resolves through membership.
 */
export async function resolveVenueOrganizer(
  userId: string,
  userRole: string,
  options: { requireManage?: boolean } = {},
): Promise<string | null> {
  if (userRole === 'SUPER_ADMIN') {
    return null; // Admin can see all
  }

  // For ORGANIZER role, the user IS the organizer
  if (userRole === 'ORGANIZER') {
    return userId;
  }

  // For STAFF role, find membership with venue permission
  const membership = await db.organizerMembership.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { organizer: { select: { userId: true } } },
  });

  if (membership) {
    const perms = getOrganizerPermissions(membership);
    const requiredPerm = options.requireManage !== false ? PERMISSIONS.VENUES_MANAGE : PERMISSIONS.VENUES_VIEW;
    if (hasPermission(perms, requiredPerm)) {
      return membership.organizer.userId;
    }
  }

  return null;
}

/**
 * Filter public-safe venue fields for unauthenticated/public users.
 * Strips private contact information.
 */
export function filterPublicVenueFields(venue: Record<string, unknown>) {
  return {
    id: venue.id,
    name: venue.name,
    description: venue.description,
    address: venue.address,
    city: venue.city,
    state: venue.state,
    country: venue.country,
    postalCode: venue.postalCode,
    lat: venue.lat,
    lng: venue.lng,
    googleMapsUrl: venue.googleMapsUrl,
    coverImage: venue.coverImage,
    capacity: venue.capacity,
    amenities: venue.amenities,
    website: venue.website,
    isPublic: venue.isPublic,
    slug: venue.slug,
    // Deliberately EXCLUDED: contactName, contactEmail, contactPhone
  };
}
