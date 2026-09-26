/**
 * Permission constants for the organizer staff system.
 * Permissions are stored as JSON arrays in OrganizerMembership.permissions.
 */

export const PERMISSIONS = {
  // Event permissions
  EVENTS_VIEW: 'events.view',
  EVENTS_CREATE: 'events.create',
  EVENTS_UPDATE: 'events.update',
  EVENTS_DELETE: 'events.delete',
  EVENTS_PUBLISH: 'events.publish',

  // Ticket permissions
  TICKETS_VIEW: 'tickets.view',
  TICKETS_MANAGE: 'tickets.manage',

  // Booking permissions
  BOOKINGS_VIEW: 'bookings.view',
  BOOKINGS_MANAGE: 'bookings.manage',

  // Analytics permissions
  ANALYTICS_VIEW: 'analytics.view',

  // Staff permissions
  STAFF_VIEW: 'staff.view',
  STAFF_MANAGE: 'staff.manage',

  // Venue permissions
  VENUES_VIEW: 'venues.view',
  VENUES_MANAGE: 'venues.manage',

  // Organizer permissions
  ORGANIZER_UPDATE: 'organizer.update',
  ORGANIZER_PROFILE: 'organizer.profile',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * All permissions — granted to organization OWNER role.
 */
export const OWNER_PERMISSIONS: string[] = [
  PERMISSIONS.EVENTS_VIEW,
  PERMISSIONS.EVENTS_CREATE,
  PERMISSIONS.EVENTS_UPDATE,
  PERMISSIONS.EVENTS_DELETE,
  PERMISSIONS.EVENTS_PUBLISH,
  PERMISSIONS.TICKETS_VIEW,
  PERMISSIONS.TICKETS_MANAGE,
  PERMISSIONS.BOOKINGS_VIEW,
  PERMISSIONS.BOOKINGS_MANAGE,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.STAFF_VIEW,
  PERMISSIONS.STAFF_MANAGE,
  PERMISSIONS.VENUES_VIEW,
  PERMISSIONS.VENUES_MANAGE,
  PERMISSIONS.ORGANIZER_UPDATE,
  PERMISSIONS.ORGANIZER_PROFILE,
];

/**
 * Default permissions for MANAGER role.
 */
export const MANAGER_PERMISSIONS: string[] = [
  PERMISSIONS.EVENTS_VIEW,
  PERMISSIONS.EVENTS_CREATE,
  PERMISSIONS.EVENTS_UPDATE,
  PERMISSIONS.TICKETS_VIEW,
  PERMISSIONS.TICKETS_MANAGE,
  PERMISSIONS.BOOKINGS_VIEW,
  PERMISSIONS.BOOKINGS_MANAGE,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.STAFF_VIEW,
  PERMISSIONS.VENUES_VIEW,
  PERMISSIONS.VENUES_MANAGE,
  PERMISSIONS.ORGANIZER_PROFILE,
];

/**
 * Default permissions for STAFF role — limited set.
 */
export const DEFAULT_STAFF_PERMISSIONS: string[] = [
  PERMISSIONS.EVENTS_VIEW,
  PERMISSIONS.TICKETS_VIEW,
  PERMISSIONS.BOOKINGS_VIEW,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.VENUES_VIEW,
  PERMISSIONS.ORGANIZER_PROFILE,
];

/**
 * Check if a user has a specific permission.
 */
export function hasPermission(userPermissions: string[], permission: string): boolean {
  return userPermissions.includes(permission);
}

/**
 * Get the effective permissions for an organizer membership.
 * Role-based defaults are used unless custom permissions are specified.
 */
export function getOrganizerPermissions(membership: { role: string; permissions: string }): string[] {
  // If custom permissions are specified (non-empty array), use those
  try {
    const customPerms = JSON.parse(membership.permissions);
    if (Array.isArray(customPerms) && customPerms.length > 0) {
      return customPerms;
    }
  } catch {
    // Invalid JSON, fall through to role defaults
  }

  // Fall back to role-based defaults
  switch (membership.role) {
    case 'OWNER':
      return OWNER_PERMISSIONS;
    case 'MANAGER':
      return MANAGER_PERMISSIONS;
    case 'STAFF':
    default:
      return DEFAULT_STAFF_PERMISSIONS;
  }
}
