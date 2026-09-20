/**
 * Phase 4B: Centralized Server-Side Entitlement Service
 *
 * This service resolves OrganizerProfile → OrganizerSubscription → SubscriptionPlan
 * to determine what an organizer's current subscription allows.
 *
 * IMPORTANT ARCHITECTURAL RULES:
 * - OrganizerSubscription is the AUTHORITATIVE source for organizer SaaS entitlements
 * - The legacy user-level Subscription model is NOT used for organizer entitlement decisions
 * - Organizer lifecycle status (ACTIVE/SUSPENDED/DEACTIVATED) is checked BEFORE subscription status
 * - The service fails safely: missing/expired subscription → free-plan defaults, never unlimited
 * - Tenant isolation: every check is tied to the authenticated user's actual OrganizerProfile
 */

import { db } from '@/lib/db';
import { ApiError } from '@/lib/errors';

// ─── Types ───

/** Organizer lifecycle status values from schema */
export type OrganizerStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEACTIVATED';

/** OrganizerSubscription status values from schema */
export type SubscriptionStatus = 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'CANCELLED';

/** Analytics access levels from schema */
export type AnalyticsLevel = 'BASIC' | 'ADVANCED' | 'FULL';

/** The set of operable organizer statuses that allow SaaS usage */
const OPERABLE_ORGANIZER_STATUSES: Set<string> = new Set(['ACTIVE', 'APPROVED']);

/** Subscription statuses that grant plan entitlements */
const ENTITLED_SUBSCRIPTION_STATUSES: Set<string> = new Set(['ACTIVE', 'TRIAL']);

/** The slug for the free/default plan — must match seed data */
const FREE_PLAN_SLUG = 'free';

// ─── Plan Limits Interface ───

export interface PlanLimits {
  maxEvents: number;
  maxTicketsPerEvent: number;
  maxTicketTypesPerEvent: number;
  maxStaff: number;
  maxMediaPerEvent: number;
  maxAttendeesTotal: number;
  canAdvertise: boolean;
  canCustomBranding: boolean;
  canApiAccess: boolean;
  analyticsLevel: AnalyticsLevel;
  trialDays: number;
  currency: string;
}

// ─── Entitlement Result ───

export interface OrganizerEntitlements {
  /** The organizer profile ID */
  organizerId: string;
  /** The organizer's lifecycle status */
  organizerStatus: OrganizerStatus;
  /** Whether the organizer is allowed to operate (ACTIVE/APPROVED) */
  isOperable: boolean;
  /** The subscription status, or null if missing */
  subscriptionStatus: SubscriptionStatus | null;
  /** Whether the subscription grants plan entitlements (ACTIVE/TRIAL) */
  isEntitled: boolean;
  /** Whether the organizer is in a trial period */
  isInTrial: boolean;
  /** The subscription plan slug (e.g., 'free', 'starter', 'professional', 'enterprise') */
  planSlug: string;
  /** The subscription plan name for display */
  planName: string;
  /** The plan limits — always populated (free-plan defaults if no subscription) */
  limits: PlanLimits;
}

// ─── Usage Interface ───

export interface OrganizerUsage {
  /** Number of events created by this organizer */
  events: number;
  /** Number of active staff/members in this organization */
  staff: number;
}

export interface EventUsage {
  /** Number of ticket types for this event */
  ticketTypes: number;
  /** Number of media items for this event */
  media: number;
  /** Number of active (non-cancelled) attendees across all bookings */
  activeAttendees: number;
}

// ─── Limit Check Result ───

export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
}

// ─── Error Codes ───

export const ENTITLEMENT_ERROR_CODES = {
  ORGANIZER_SUSPENDED: 'ORGANIZER_SUSPENDED',
  ORGANIZER_DEACTIVATED: 'ORGANIZER_DEACTIVATED',
  ORGANIZER_NOT_OPERABLE: 'ORGANIZER_NOT_OPERABLE',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  FEATURE_NOT_AVAILABLE: 'FEATURE_NOT_AVAILABLE',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
} as const;

// ─── Core: Resolve Organizer Entitlements ───

/**
 * Resolve the full entitlement state for an organizer.
 *
 * Resolution chain:
 *   User (authenticated) → OrganizerProfile → OrganizerSubscription → SubscriptionPlan
 *
 * If OrganizerSubscription is missing or expired, falls back to the free plan.
 * If the free plan doesn't exist in DB, uses hardcoded safe defaults.
 * Never grants unlimited access.
 *
 * @param userId - The authenticated user's ID (for tenant isolation)
 * @throws ApiError if user has no OrganizerProfile
 */
export async function getOrganizerEntitlements(userId: string): Promise<OrganizerEntitlements> {
  // 1. Resolve OrganizerProfile from the authenticated user
  const profile = await db.organizerProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      organizerSubscription: {
        include: {
          plan: {
            select: {
              slug: true,
              name: true,
              maxEvents: true,
              maxTicketsPerEvent: true,
              maxTicketTypesPerEvent: true,
              maxStaff: true,
              maxMediaPerEvent: true,
              maxAttendeesTotal: true,
              canAdvertise: true,
              canCustomBranding: true,
              canApiAccess: true,
              analyticsLevel: true,
              trialDays: true,
              currency: true,
            },
          },
        },
      },
    },
  });

  if (!profile) {
    throw new ApiError(403, 'FORBIDDEN', 'Organizer profile not found');
  }

  const organizerStatus = profile.status as OrganizerStatus;
  const isOperable = OPERABLE_ORGANIZER_STATUSES.has(organizerStatus);

  // 2. Resolve subscription and plan
  const subscription = profile.organizerSubscription;
  let subscriptionStatus: SubscriptionStatus | null = null;
  let isInTrial = false;
  let planSlug: string;
  let planName: string;
  let limits: PlanLimits;

  if (subscription && ENTITLED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    // Active or trial subscription — use its plan
    subscriptionStatus = subscription.status as SubscriptionStatus;
    isInTrial = subscription.isInTrial || subscription.status === 'TRIAL';

    // Check if subscription has expired (endDate in the past)
    if (subscription.endDate && subscription.endDate < new Date()) {
      // Subscription record says ACTIVE/TRIAL but endDate has passed
      // Treat as expired for safety
      subscriptionStatus = 'EXPIRED';
      isInTrial = false;
      const freePlan = await resolveFreePlan();
      planSlug = freePlan.slug;
      planName = freePlan.name;
      limits = freePlan.limits;
    } else {
      planSlug = subscription.plan.slug;
      planName = subscription.plan.name;
      limits = {
        maxEvents: subscription.plan.maxEvents,
        maxTicketsPerEvent: subscription.plan.maxTicketsPerEvent,
        maxTicketTypesPerEvent: subscription.plan.maxTicketTypesPerEvent,
        maxStaff: subscription.plan.maxStaff,
        maxMediaPerEvent: subscription.plan.maxMediaPerEvent,
        maxAttendeesTotal: subscription.plan.maxAttendeesTotal,
        canAdvertise: subscription.plan.canAdvertise,
        canCustomBranding: subscription.plan.canCustomBranding,
        canApiAccess: subscription.plan.canApiAccess,
        analyticsLevel: subscription.plan.analyticsLevel as AnalyticsLevel,
        trialDays: subscription.plan.trialDays,
        currency: subscription.plan.currency,
      };
    }
  } else {
    // No subscription, or subscription is EXPIRED/CANCELLED
    subscriptionStatus = subscription ? (subscription.status as SubscriptionStatus) : null;
    const freePlan = await resolveFreePlan();
    planSlug = freePlan.slug;
    planName = freePlan.name;
    limits = freePlan.limits;
  }

  const isEntitled = isOperable && subscriptionStatus !== null && ENTITLED_SUBSCRIPTION_STATUSES.has(subscriptionStatus);

  return {
    organizerId: profile.id,
    organizerStatus,
    isOperable,
    subscriptionStatus,
    isEntitled,
    isInTrial,
    planSlug,
    planName,
    limits,
  };
}

// ─── Resolve by OrganizerProfile ID (for routes that already have the profile) ───

/**
 * Resolve entitlements when you already have the organizerProfile ID.
 * Used by routes that resolve the organizer through event ownership or membership.
 */
export async function getOrganizerEntitlementsById(organizerId: string): Promise<OrganizerEntitlements> {
  const profile = await db.organizerProfile.findUnique({
    where: { id: organizerId },
    select: {
      id: true,
      status: true,
      userId: true,
      organizerSubscription: {
        include: {
          plan: {
            select: {
              slug: true,
              name: true,
              maxEvents: true,
              maxTicketsPerEvent: true,
              maxTicketTypesPerEvent: true,
              maxStaff: true,
              maxMediaPerEvent: true,
              maxAttendeesTotal: true,
              canAdvertise: true,
              canCustomBranding: true,
              canApiAccess: true,
              analyticsLevel: true,
              trialDays: true,
              currency: true,
            },
          },
        },
      },
    },
  });

  if (!profile) {
    throw new ApiError(403, 'FORBIDDEN', 'Organizer profile not found');
  }

  // Delegate to the same logic using userId (which will find the same profile)
  return getOrganizerEntitlements(profile.userId);
}

// ─── Free Plan Resolution ───

/** Hardcoded safe defaults — used only if the free plan doesn't exist in DB */
const FREE_PLAN_DEFAULTS: PlanLimits = {
  maxEvents: 3,
  maxTicketsPerEvent: 50,
  maxTicketTypesPerEvent: 2,
  maxStaff: 0,
  maxMediaPerEvent: 3,
  maxAttendeesTotal: 500,
  canAdvertise: false,
  canCustomBranding: false,
  canApiAccess: false,
  analyticsLevel: 'BASIC' as AnalyticsLevel,
  trialDays: 0,
  currency: 'GHS',
};

/** Cached free plan result (per-process, never stale since plans rarely change) */
let _freePlanCache: { slug: string; name: string; limits: PlanLimits } | null = null;

async function resolveFreePlan(): Promise<{ slug: string; name: string; limits: PlanLimits }> {
  if (_freePlanCache) return _freePlanCache;

  const freePlan = await db.subscriptionPlan.findUnique({
    where: { slug: FREE_PLAN_SLUG },
    select: {
      slug: true,
      name: true,
      maxEvents: true,
      maxTicketsPerEvent: true,
      maxTicketTypesPerEvent: true,
      maxStaff: true,
      maxMediaPerEvent: true,
      maxAttendeesTotal: true,
      canAdvertise: true,
      canCustomBranding: true,
      canApiAccess: true,
      analyticsLevel: true,
      trialDays: true,
      currency: true,
    },
  });

  if (freePlan) {
    const result = {
      slug: freePlan.slug,
      name: freePlan.name,
      limits: {
        maxEvents: freePlan.maxEvents,
        maxTicketsPerEvent: freePlan.maxTicketsPerEvent,
        maxTicketTypesPerEvent: freePlan.maxTicketTypesPerEvent,
        maxStaff: freePlan.maxStaff,
        maxMediaPerEvent: freePlan.maxMediaPerEvent,
        maxAttendeesTotal: freePlan.maxAttendeesTotal,
        canAdvertise: freePlan.canAdvertise,
        canCustomBranding: freePlan.canCustomBranding,
        canApiAccess: freePlan.canApiAccess,
        analyticsLevel: freePlan.analyticsLevel as AnalyticsLevel,
        trialDays: freePlan.trialDays,
        currency: freePlan.currency,
      },
    };
    _freePlanCache = result;
    return result;
  }

  // Free plan not in DB — use hardcoded safe defaults
  return {
    slug: FREE_PLAN_SLUG,
    name: 'Free',
    limits: FREE_PLAN_DEFAULTS,
  };
}

/** Invalidate the free plan cache (for tests) */
export function _invalidateFreePlanCache() {
  _freePlanCache = null;
}

// ─── Organizer Status Guard ───

/**
 * Verify the organizer is operable (ACTIVE or APPROVED).
 * Throws ApiError if suspended, deactivated, or not operable.
 * MUST be called before any entitlement check.
 */
export function requireOperableOrganizer(entitlements: OrganizerEntitlements): void {
  if (entitlements.organizerStatus === 'SUSPENDED') {
    throw new ApiError(403, ENTITLEMENT_ERROR_CODES.ORGANIZER_SUSPENDED, 'Your organizer account is suspended');
  }
  if (entitlements.organizerStatus === 'DEACTIVATED') {
    throw new ApiError(403, ENTITLEMENT_ERROR_CODES.ORGANIZER_DEACTIVATED, 'Your organizer account has been deactivated');
  }
  if (!entitlements.isOperable) {
    throw new ApiError(403, ENTITLEMENT_ERROR_CODES.ORGANIZER_NOT_OPERABLE, 'Your organizer account is not active');
  }
}

// ─── Subscription Status Guard ───

/**
 * Verify the organizer has an entitled subscription (ACTIVE or TRIAL).
 * Throws ApiError with appropriate code if not.
 */
export function requireEntitledSubscription(entitlements: OrganizerEntitlements): void {
  if (entitlements.subscriptionStatus === 'EXPIRED') {
    throw new ApiError(402, ENTITLEMENT_ERROR_CODES.SUBSCRIPTION_EXPIRED, 'Your subscription has expired. Please renew to continue.', {
      planSlug: entitlements.planSlug,
    });
  }
  if (entitlements.subscriptionStatus === 'CANCELLED') {
    throw new ApiError(402, ENTITLEMENT_ERROR_CODES.SUBSCRIPTION_REQUIRED, 'An active subscription is required', {
      planSlug: entitlements.planSlug,
    });
  }
  if (entitlements.subscriptionStatus === null) {
    // No subscription at all — free plan is allowed, so this is not an error
    // unless the calling code specifically requires a paid subscription.
    // We just return; the free plan limits are already applied.
    return;
  }
}

// ─── Feature Flag Checks ───

export interface FeatureFlagKey {
  canAdvertise: boolean;
  canCustomBranding: boolean;
  canApiAccess: boolean;
}

type FeatureFlagName = keyof FeatureFlagKey;

const FEATURE_FLAG_LABELS: Record<FeatureFlagName, string> = {
  canAdvertise: 'Advertisement placement',
  canCustomBranding: 'Custom branding',
  canApiAccess: 'API access',
};

/**
 * Require that a specific feature flag is enabled on the organizer's plan.
 * Throws ApiError(FEATURE_NOT_AVAILABLE) if the feature is not available.
 */
export function requireFeature(entitlements: OrganizerEntitlements, feature: FeatureFlagName): void {
  if (!entitlements.limits[feature]) {
    throw new ApiError(403, ENTITLEMENT_ERROR_CODES.FEATURE_NOT_AVAILABLE, `${FEATURE_FLAG_LABELS[feature]} is not available on your current plan`, {
      feature,
      currentPlan: entitlements.planSlug,
    });
  }
}

/**
 * Check analytics access level.
 * Returns the analytics level; the caller decides if the requested analytics
 * depth is available.
 */
export function getAnalyticsAccess(entitlements: OrganizerEntitlements): AnalyticsLevel {
  return entitlements.limits.analyticsLevel;
}

/**
 * Require that the analytics level meets a minimum.
 * Level hierarchy: BASIC < ADVANCED < FULL
 */
const ANALYTICS_LEVEL_ORDER: Record<AnalyticsLevel, number> = {
  BASIC: 0,
  ADVANCED: 1,
  FULL: 2,
};

export function requireAnalyticsLevel(entitlements: OrganizerEntitlements, minimum: AnalyticsLevel): void {
  const currentLevel = ANALYTICS_LEVEL_ORDER[entitlements.limits.analyticsLevel];
  const requiredLevel = ANALYTICS_LEVEL_ORDER[minimum];
  if (currentLevel < requiredLevel) {
    throw new ApiError(403, ENTITLEMENT_ERROR_CODES.FEATURE_NOT_AVAILABLE, `${minimum} analytics is not available on your current plan`, {
      feature: 'analyticsLevel',
      currentLevel: entitlements.limits.analyticsLevel,
      requiredLevel: minimum,
      currentPlan: entitlements.planSlug,
    });
  }
}

// ─── Usage Calculation ───

/**
 * Get current usage counts for an organizer (across all events).
 */
export async function getOrganizerUsage(organizerId: string): Promise<OrganizerUsage> {
  // We need the userId from the organizer profile to count events
  const profile = await db.organizerProfile.findUnique({
    where: { id: organizerId },
    select: { userId: true },
  });

  if (!profile) {
    return { events: 0, staff: 0 };
  }

  const [events, staff] = await Promise.all([
    db.event.count({ where: { organizerId: profile.userId } }),
    db.organizerMembership.count({
      where: { organizerId, status: 'ACTIVE' },
    }),
  ]);

  return { events, staff };
}

/**
 * Get current usage counts for a specific event.
 * Active attendees = confirmed bookings (not cancelled/refunded).
 */
export async function getEventUsage(eventId: string): Promise<EventUsage> {
  const [ticketTypes, media, activeAttendees] = await Promise.all([
    db.ticketType.count({ where: { eventId } }),
    db.eventMedia.count({ where: { eventId } }),
    db.booking.count({
      where: {
        eventId,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    }),
  ]);

  return { ticketTypes, media, activeAttendees };
}

// ─── Limit Enforcement ───

/**
 * Check if a numeric limit is within bounds.
 * Returns a LimitCheckResult with allowed/denied status and usage info.
 */
export function checkLimit(current: number, limit: number): LimitCheckResult {
  const remaining = Math.max(0, limit - current);
  return {
    allowed: current < limit,
    current,
    limit,
    remaining,
  };
}

/**
 * Require that a numeric limit has not been reached.
 * Throws ApiError(PLAN_LIMIT_REACHED) if at or over the limit.
 */
export function requireWithinLimit(
  current: number,
  limit: number,
  limitName: string,
  planSlug: string,
): void {
  if (current >= limit) {
    throw new ApiError(403, ENTITLEMENT_ERROR_CODES.PLAN_LIMIT_REACHED, `You have reached the ${limitName} limit for your plan`, {
      limit: limitName,
      current,
      max: limit,
      remaining: 0,
      planSlug,
    });
  }
}

// ─── Convenience: Full Entitlement Check for Organizer ───

/**
 * Get entitlements AND verify the organizer is operable.
 * This is the most common entry point for protected routes.
 *
 * @param userId - Authenticated user's ID
 * @returns OrganizerEntitlements (guaranteed operable)
 * @throws ApiError if not operable
 */
export async function getOperableOrganizerEntitlements(userId: string): Promise<OrganizerEntitlements> {
  const entitlements = await getOrganizerEntitlements(userId);
  requireOperableOrganizer(entitlements);
  return entitlements;
}

/**
 * Resolve the OrganizerProfile for an authenticated user.
 * Returns null if the user has no profile (not an organizer).
 */
export async function resolveOrganizerProfile(userId: string): Promise<{ id: string; status: string } | null> {
  const profile = await db.organizerProfile.findUnique({
    where: { userId },
    select: { id: true, status: true },
  });
  return profile;
}

/**
 * Resolve the organizer profile ID for a user who owns an event.
 * Used when a route needs to check entitlements based on event ownership.
 */
export async function resolveOrganizerFromEvent(eventOrganizerUserId: string): Promise<string | null> {
  const profile = await db.organizerProfile.findUnique({
    where: { userId: eventOrganizerUserId },
    select: { id: true },
  });
  return profile?.id ?? null;
}
