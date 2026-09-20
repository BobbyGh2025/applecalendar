/**
 * Phase 4B Tests: Entitlement & Subscription Enforcement
 *
 * Tests cover:
 * - Limit checking logic (checkLimit, requireWithinLimit)
 * - Organizer status guards (ACTIVE, SUSPENDED, DEACTIVATED)
 * - Feature flag checks (canAdvertise, canCustomBranding, canApiAccess)
 * - Analytics level enforcement
 * - Subscription status handling
 * - Error contract (unified API error format with machine-readable codes)
 * - Subscription resolution against the database
 * - Usage calculation
 * - Free plan fallback
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  getOrganizerEntitlements,
  getOperableOrganizerEntitlements,
  requireOperableOrganizer,
  requireEntitledSubscription,
  requireFeature,
  requireAnalyticsLevel,
  getAnalyticsAccess,
  getOrganizerUsage,
  getEventUsage,
  checkLimit,
  requireWithinLimit,
  resolveOrganizerProfile,
  _invalidateFreePlanCache,
  ENTITLEMENT_ERROR_CODES,
  type OrganizerEntitlements,
  type PlanLimits,
  type AnalyticsLevel,
} from '@/lib/services/entitlements';
import { ApiError } from '@/lib/errors';

const prisma = new PrismaClient();

// ─── Helper: create test entitlements object ───

function makeEntitlements(overrides: Partial<OrganizerEntitlements> = {}): OrganizerEntitlements {
  return {
    organizerId: 'test-org-id',
    organizerStatus: 'ACTIVE',
    isOperable: true,
    subscriptionStatus: 'ACTIVE',
    isEntitled: true,
    isInTrial: false,
    planSlug: 'professional',
    planName: 'Professional',
    limits: {
      maxEvents: 50,
      maxTicketsPerEvent: 5000,
      maxTicketTypesPerEvent: 10,
      maxStaff: 5,
      maxMediaPerEvent: 20,
      maxAttendeesTotal: 10000,
      canAdvertise: true,
      canCustomBranding: true,
      canApiAccess: true,
      analyticsLevel: 'FULL',
      trialDays: 14,
      currency: 'GHS',
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════
// UNIT TESTS (no database required)
// ═══════════════════════════════════════════

describe('Phase 4B — Entitlement Unit Tests', () => {
  // ─── checkLimit ───

  describe('checkLimit', () => {
    it('allows when current is below limit', () => {
      const result = checkLimit(3, 5);
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(3);
      expect(result.limit).toBe(5);
      expect(result.remaining).toBe(2);
    });

    it('denies when current equals limit', () => {
      const result = checkLimit(5, 5);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('denies when current exceeds limit', () => {
      const result = checkLimit(6, 5);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('allows at zero usage', () => {
      const result = checkLimit(0, 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
    });
  });

  // ─── requireWithinLimit ───

  describe('requireWithinLimit', () => {
    it('passes when within limit', () => {
      expect(() => requireWithinLimit(3, 5, 'events', 'starter')).not.toThrow();
    });

    it('throws PLAN_LIMIT_REACHED when at limit', () => {
      expect(() => requireWithinLimit(5, 5, 'events', 'starter')).toThrow();
      try {
        requireWithinLimit(5, 5, 'events', 'starter');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe(ENTITLEMENT_ERROR_CODES.PLAN_LIMIT_REACHED);
        expect(apiErr.statusCode).toBe(403);
        expect(apiErr.details).toEqual({
          limit: 'events',
          current: 5,
          max: 5,
          remaining: 0,
          planSlug: 'starter',
        });
      }
    });

    it('throws PLAN_LIMIT_REACHED when over limit', () => {
      expect(() => requireWithinLimit(6, 5, 'staff', 'free')).toThrow();
    });

    it('includes limit name and plan slug in error details', () => {
      try {
        requireWithinLimit(2, 2, 'ticket types per event', 'free');
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.details).toHaveProperty('limit', 'ticket types per event');
        expect(apiErr.details).toHaveProperty('planSlug', 'free');
      }
    });
  });

  // ─── requireOperableOrganizer ───

  describe('requireOperableOrganizer', () => {
    it('passes for ACTIVE organizer', () => {
      expect(() => requireOperableOrganizer(makeEntitlements({ organizerStatus: 'ACTIVE', isOperable: true }))).not.toThrow();
    });

    it('passes for APPROVED organizer', () => {
      expect(() => requireOperableOrganizer(makeEntitlements({ organizerStatus: 'APPROVED', isOperable: true }))).not.toThrow();
    });

    it('throws ORGANIZER_SUSPENDED for SUSPENDED organizer', () => {
      expect(() => requireOperableOrganizer(makeEntitlements({ organizerStatus: 'SUSPENDED', isOperable: false }))).toThrow();
      try {
        requireOperableOrganizer(makeEntitlements({ organizerStatus: 'SUSPENDED', isOperable: false }));
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.ORGANIZER_SUSPENDED);
        expect((err as ApiError).statusCode).toBe(403);
      }
    });

    it('throws ORGANIZER_DEACTIVATED for DEACTIVATED organizer', () => {
      expect(() => requireOperableOrganizer(makeEntitlements({ organizerStatus: 'DEACTIVATED', isOperable: false }))).toThrow();
      try {
        requireOperableOrganizer(makeEntitlements({ organizerStatus: 'DEACTIVATED', isOperable: false }));
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.ORGANIZER_DEACTIVATED);
      }
    });

    it('throws ORGANIZER_NOT_OPERABLE for PENDING_APPROVAL organizer', () => {
      expect(() => requireOperableOrganizer(makeEntitlements({ organizerStatus: 'PENDING_APPROVAL', isOperable: false }))).toThrow();
      try {
        requireOperableOrganizer(makeEntitlements({ organizerStatus: 'PENDING_APPROVAL', isOperable: false }));
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.ORGANIZER_NOT_OPERABLE);
      }
    });

    it('throws ORGANIZER_NOT_OPERABLE for REJECTED organizer', () => {
      expect(() => requireOperableOrganizer(makeEntitlements({ organizerStatus: 'REJECTED', isOperable: false }))).toThrow();
    });
  });

  // ─── requireFeature ───

  describe('requireFeature', () => {
    it('passes when canAdvertise is true', () => {
      expect(() => requireFeature(makeEntitlements(), 'canAdvertise')).not.toThrow();
    });

    it('throws FEATURE_NOT_AVAILABLE when canAdvertise is false', () => {
      const e = makeEntitlements({ limits: { ...makeEntitlements().limits, canAdvertise: false } });
      expect(() => requireFeature(e, 'canAdvertise')).toThrow();
      try {
        requireFeature(e, 'canAdvertise');
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.FEATURE_NOT_AVAILABLE);
        expect((err as ApiError).statusCode).toBe(403);
        expect((err as ApiError).details).toHaveProperty('feature', 'canAdvertise');
      }
    });

    it('throws FEATURE_NOT_AVAILABLE when canCustomBranding is false', () => {
      const e = makeEntitlements({ limits: { ...makeEntitlements().limits, canCustomBranding: false } });
      expect(() => requireFeature(e, 'canCustomBranding')).toThrow();
    });

    it('throws FEATURE_NOT_AVAILABLE when canApiAccess is false', () => {
      const e = makeEntitlements({ limits: { ...makeEntitlements().limits, canApiAccess: false } });
      expect(() => requireFeature(e, 'canApiAccess')).toThrow();
    });

    it('includes feature name and current plan in error details', () => {
      const e = makeEntitlements({ planSlug: 'free', limits: { ...makeEntitlements().limits, canApiAccess: false } });
      try {
        requireFeature(e, 'canApiAccess');
      } catch (err) {
        const apiErr = err as ApiError;
        expect(apiErr.details).toHaveProperty('feature', 'canApiAccess');
        expect(apiErr.details).toHaveProperty('currentPlan', 'free');
      }
    });
  });

  // ─── requireAnalyticsLevel ───

  describe('requireAnalyticsLevel', () => {
    function makeWithLevel(level: AnalyticsLevel): OrganizerEntitlements {
      return makeEntitlements({ limits: { ...makeEntitlements().limits, analyticsLevel: level } });
    }

    it('BASIC allows BASIC', () => {
      expect(() => requireAnalyticsLevel(makeWithLevel('BASIC'), 'BASIC')).not.toThrow();
    });

    it('ADVANCED allows ADVANCED', () => {
      expect(() => requireAnalyticsLevel(makeWithLevel('ADVANCED'), 'ADVANCED')).not.toThrow();
    });

    it('FULL allows FULL', () => {
      expect(() => requireAnalyticsLevel(makeWithLevel('FULL'), 'FULL')).not.toThrow();
    });

    it('FULL allows ADVANCED', () => {
      expect(() => requireAnalyticsLevel(makeWithLevel('FULL'), 'ADVANCED')).not.toThrow();
    });

    it('FULL allows BASIC', () => {
      expect(() => requireAnalyticsLevel(makeWithLevel('FULL'), 'BASIC')).not.toThrow();
    });

    it('BASIC denies ADVANCED', () => {
      expect(() => requireAnalyticsLevel(makeWithLevel('BASIC'), 'ADVANCED')).toThrow();
      try {
        requireAnalyticsLevel(makeWithLevel('BASIC'), 'ADVANCED');
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.FEATURE_NOT_AVAILABLE);
      }
    });

    it('BASIC denies FULL', () => {
      expect(() => requireAnalyticsLevel(makeWithLevel('BASIC'), 'FULL')).toThrow();
    });

    it('ADVANCED denies FULL', () => {
      expect(() => requireAnalyticsLevel(makeWithLevel('ADVANCED'), 'FULL')).toThrow();
    });
  });

  // ─── getAnalyticsAccess ───

  describe('getAnalyticsAccess', () => {
    it('returns the analytics level from entitlements', () => {
      expect(getAnalyticsAccess(makeEntitlements({ limits: { ...makeEntitlements().limits, analyticsLevel: 'ADVANCED' } }))).toBe('ADVANCED');
    });
  });

  // ─── requireEntitledSubscription ───

  describe('requireEntitledSubscription', () => {
    it('passes for ACTIVE subscription', () => {
      expect(() => requireEntitledSubscription(makeEntitlements({ subscriptionStatus: 'ACTIVE', isEntitled: true }))).not.toThrow();
    });

    it('passes for TRIAL subscription', () => {
      expect(() => requireEntitledSubscription(makeEntitlements({ subscriptionStatus: 'TRIAL', isEntitled: true, isInTrial: true }))).not.toThrow();
    });

    it('throws SUBSCRIPTION_EXPIRED for EXPIRED subscription', () => {
      expect(() => requireEntitledSubscription(makeEntitlements({ subscriptionStatus: 'EXPIRED', isEntitled: false }))).toThrow();
      try {
        requireEntitledSubscription(makeEntitlements({ subscriptionStatus: 'EXPIRED', isEntitled: false }));
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.SUBSCRIPTION_EXPIRED);
        expect((err as ApiError).statusCode).toBe(402);
      }
    });

    it('throws SUBSCRIPTION_REQUIRED for CANCELLED subscription', () => {
      expect(() => requireEntitledSubscription(makeEntitlements({ subscriptionStatus: 'CANCELLED', isEntitled: false }))).toThrow();
      try {
        requireEntitledSubscription(makeEntitlements({ subscriptionStatus: 'CANCELLED', isEntitled: false }));
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.SUBSCRIPTION_REQUIRED);
      }
    });

    it('passes for null subscription (free plan allowed)', () => {
      expect(() => requireEntitledSubscription(makeEntitlements({ subscriptionStatus: null, isEntitled: false }))).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════
// DATABASE INTEGRATION TESTS
// ═══════════════════════════════════════════

describe('Phase 4B — Entitlement DB Integration', () => {
  let testPlanId: string;

  beforeAll(async () => {
    _invalidateFreePlanCache();

    // Ensure free plan exists
    await prisma.subscriptionPlan.upsert({
      where: { slug: 'free' },
      update: {},
      create: {
        name: 'Free', slug: 'free', description: 'Free plan', price: 0, interval: 'MONTHLY',
        currency: 'GHS', maxEvents: 3, maxTicketsPerEvent: 50, maxTicketTypesPerEvent: 2,
        maxStaff: 0, maxMediaPerEvent: 3, maxAttendeesTotal: 500, canAdvertise: false,
        canCustomBranding: false, canApiAccess: false, analyticsLevel: 'BASIC',
        trialDays: 0, features: '[]',
      },
    });

    // Ensure professional plan exists
    const profPlan = await prisma.subscriptionPlan.upsert({
      where: { slug: 'professional' },
      update: {},
      create: {
        name: 'Professional', slug: 'professional', description: 'Pro plan', price: 299,
        interval: 'MONTHLY', currency: 'GHS', maxEvents: 50, maxTicketsPerEvent: 5000,
        maxTicketTypesPerEvent: 10, maxStaff: 5, maxMediaPerEvent: 20,
        maxAttendeesTotal: 10000, canAdvertise: true, canCustomBranding: true,
        canApiAccess: true, analyticsLevel: 'FULL', trialDays: 14, features: '[]',
      },
    });
    testPlanId = profPlan.id;
  });

  afterAll(async () => {
    // Cleanup: delete test data in reverse dependency order
    const testUsers = await prisma.user.findMany({
      where: { email: { startsWith: 'ent-test-' } },
      select: { id: true },
    });
    const testUserIds = testUsers.map(u => u.id);

    // Delete events created by test users
    if (testUserIds.length > 0) {
      await prisma.event.deleteMany({ where: { organizerId: { in: testUserIds } } });
    }

    // Delete memberships for test users
    if (testUserIds.length > 0) {
      await prisma.organizerMembership.deleteMany({ where: { userId: { in: testUserIds } } });
    }

    const testOrgs = await prisma.organizerProfile.findMany({
      where: { organizationName: { startsWith: 'Ent-Test-' } },
      select: { id: true },
    });
    for (const org of testOrgs) {
      await prisma.organizerSubscription.deleteMany({ where: { organizerId: org.id } });
      await prisma.organizerMembership.deleteMany({ where: { organizerId: org.id } });
      await prisma.organizerInvitation.deleteMany({ where: { organizerId: org.id } });
    }
    await prisma.organizerProfile.deleteMany({ where: { organizationName: { startsWith: 'Ent-Test-' } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'ent-test-' } } });
    await prisma.$disconnect();
  });

  // ─── Subscription Resolution ───

  describe('Subscription Resolution', () => {
    it('resolves active subscription with correct plan limits', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-active@example.com', password: 'x', name: 'Active Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const profile = await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-Active', slug: `ent-test-active-${Date.now()}`, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      });
      await prisma.organizerSubscription.create({
        data: { organizerId: profile.id, planId: testPlanId, status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000) },
      });

      const entitlements = await getOrganizerEntitlements(user.id);
      expect(entitlements.organizerId).toBe(profile.id);
      expect(entitlements.organizerStatus).toBe('ACTIVE');
      expect(entitlements.isOperable).toBe(true);
      expect(entitlements.subscriptionStatus).toBe('ACTIVE');
      expect(entitlements.isEntitled).toBe(true);
      expect(entitlements.planSlug).toBe('professional');
      expect(entitlements.limits.maxEvents).toBe(50);
      expect(entitlements.limits.maxStaff).toBe(5);
      expect(entitlements.limits.canAdvertise).toBe(true);
      expect(entitlements.limits.analyticsLevel).toBe('FULL');
    });

    it('falls back to free plan for expired subscription', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-expired@example.com', password: 'x', name: 'Expired Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const profile = await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-Expired', slug: `ent-test-expired-${Date.now()}`, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      });
      await prisma.organizerSubscription.create({
        data: { organizerId: profile.id, planId: testPlanId, status: 'EXPIRED', startDate: new Date(Date.now() - 60 * 86400000), endDate: new Date(Date.now() - 1) },
      });

      const entitlements = await getOrganizerEntitlements(user.id);
      expect(entitlements.subscriptionStatus).toBe('EXPIRED');
      expect(entitlements.isEntitled).toBe(false);
      expect(entitlements.planSlug).toBe('free');
      expect(entitlements.limits.maxEvents).toBe(3);
      expect(entitlements.limits.canAdvertise).toBe(false);
    });

    it('falls back to free plan for missing subscription', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-nosub@example.com', password: 'x', name: 'No Sub Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-NoSub', slug: `ent-test-nosub-${Date.now()}`, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      });

      const entitlements = await getOrganizerEntitlements(user.id);
      expect(entitlements.subscriptionStatus).toBeNull();
      expect(entitlements.isEntitled).toBe(false);
      expect(entitlements.planSlug).toBe('free');
      expect(entitlements.limits.maxStaff).toBe(0);
    });

    it('resolves TRIAL subscription with isInTrial=true', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-trial@example.com', password: 'x', name: 'Trial Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const profile = await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-Trial', slug: `ent-test-trial-${Date.now()}`, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      });
      await prisma.organizerSubscription.create({
        data: {
          organizerId: profile.id, planId: testPlanId, status: 'TRIAL',
          startDate: new Date(), endDate: new Date(Date.now() + 14 * 86400000),
          isInTrial: true, trialStart: new Date(), trialEnd: new Date(Date.now() + 14 * 86400000),
        },
      });

      const entitlements = await getOrganizerEntitlements(user.id);
      expect(entitlements.subscriptionStatus).toBe('TRIAL');
      expect(entitlements.isInTrial).toBe(true);
      expect(entitlements.isEntitled).toBe(true);
      expect(entitlements.planSlug).toBe('professional');
    });

    it('falls back to free plan for CANCELLED subscription', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-cancelled@example.com', password: 'x', name: 'Cancelled Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const profile = await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-Cancelled', slug: `ent-test-cancelled-${Date.now()}`, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      });
      await prisma.organizerSubscription.create({
        data: {
          organizerId: profile.id, planId: testPlanId, status: 'CANCELLED',
          startDate: new Date(), endDate: new Date(Date.now() - 1),
          cancelledAt: new Date(), cancelReason: 'User requested',
        },
      });

      const entitlements = await getOrganizerEntitlements(user.id);
      expect(entitlements.subscriptionStatus).toBe('CANCELLED');
      expect(entitlements.isEntitled).toBe(false);
      expect(entitlements.planSlug).toBe('free');
    });

    it('treats ACTIVE subscription with past endDate as expired', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-pastend@example.com', password: 'x', name: 'Past End Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const profile = await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-PastEnd', slug: `ent-test-pastend-${Date.now()}`, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      });
      await prisma.organizerSubscription.create({
        data: {
          organizerId: profile.id, planId: testPlanId, status: 'ACTIVE',
          startDate: new Date(Date.now() - 60 * 86400000), endDate: new Date(Date.now() - 1),
        },
      });

      const entitlements = await getOrganizerEntitlements(user.id);
      expect(entitlements.subscriptionStatus).toBe('EXPIRED');
      expect(entitlements.planSlug).toBe('free');
    });
  });

  // ─── Organizer Status Enforcement ───

  describe('Organizer Status Enforcement', () => {
    it('denies operable check for SUSPENDED organizer with active subscription', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-suspended@example.com', password: 'x', name: 'Suspended Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const profile = await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-Suspended', slug: `ent-test-suspended-${Date.now()}`, status: 'SUSPENDED', approvalStatus: 'APPROVED' },
      });
      await prisma.organizerSubscription.create({
        data: { organizerId: profile.id, planId: testPlanId, status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000) },
      });

      await expect(getOperableOrganizerEntitlements(user.id)).rejects.toThrow();
      try {
        await getOperableOrganizerEntitlements(user.id);
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.ORGANIZER_SUSPENDED);
      }
    });

    it('denies operable check for DEACTIVATED organizer', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-deactivated@example.com', password: 'x', name: 'Deactivated Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-Deactivated', slug: `ent-test-deactivated-${Date.now()}`, status: 'DEACTIVATED', approvalStatus: 'APPROVED' },
      });

      await expect(getOperableOrganizerEntitlements(user.id)).rejects.toThrow();
      try {
        await getOperableOrganizerEntitlements(user.id);
      } catch (err) {
        expect((err as ApiError).code).toBe(ENTITLEMENT_ERROR_CODES.ORGANIZER_DEACTIVATED);
      }
    });
  });

  // ─── Usage Calculation ───

  describe('Usage Calculation', () => {
    it('getOrganizerUsage returns correct event and staff counts', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-usage@example.com', password: 'x', name: 'Usage Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const profile = await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-Usage', slug: `ent-test-usage-${Date.now()}`, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      });

      // Create 2 events
      const ts = Date.now();
      await prisma.event.createMany({
        data: [
          { id: `ent-usage-1-${ts}`, title: 'Test 1', slug: `test-1-${ts}`, description: 'x', organizerId: user.id, status: 'DRAFT', startDate: new Date() },
          { id: `ent-usage-2-${ts}`, title: 'Test 2', slug: `test-2-${ts}`, description: 'x', organizerId: user.id, status: 'DRAFT', startDate: new Date() },
        ],
      });

      // Create 1 active staff member
      const staffUser = await prisma.user.create({
        data: { email: `ent-test-usage-staff@example.com`, password: 'x', name: 'Staff', role: 'STAFF', isActive: true, emailVerified: new Date() },
      });
      await prisma.organizerMembership.create({
        data: { organizerId: profile.id, userId: staffUser.id, role: 'STAFF', status: 'ACTIVE', permissions: '[]' },
      });

      const usage = await getOrganizerUsage(profile.id);
      expect(usage.events).toBe(2);
      expect(usage.staff).toBe(1);
    });

    it('getEventUsage returns correct ticket type and media counts', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-eventusage@example.com', password: 'x', name: 'Event Usage Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const evt = await prisma.event.create({
        data: { title: 'Usage Event', slug: `usage-event-${Date.now()}`, description: 'x', organizerId: user.id, status: 'PUBLISHED', startDate: new Date() },
      });

      // Create 2 ticket types
      await prisma.ticketType.createMany({
        data: [
          { eventId: evt.id, name: 'General', price: 100, quantity: 500, currency: 'GHS' },
          { eventId: evt.id, name: 'VIP', price: 500, quantity: 100, currency: 'GHS' },
        ],
      });

      const usage = await getEventUsage(evt.id);
      expect(usage.ticketTypes).toBe(2);
      expect(usage.media).toBe(0);
      expect(usage.activeAttendees).toBe(0);
    });
  });

  // ─── resolveOrganizerProfile ───

  describe('resolveOrganizerProfile', () => {
    it('returns profile for user with organizer profile', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-resolve@example.com', password: 'x', name: 'Resolve Org', role: 'ORGANIZER', isActive: true, emailVerified: new Date() },
      });
      const profile = await prisma.organizerProfile.create({
        data: { userId: user.id, organizationName: 'Ent-Test-Resolve', slug: `ent-test-resolve-${Date.now()}`, status: 'ACTIVE', approvalStatus: 'APPROVED' },
      });

      const result = await resolveOrganizerProfile(user.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(profile.id);
      expect(result?.status).toBe('ACTIVE');
    });

    it('returns null for user without organizer profile', async () => {
      const user = await prisma.user.create({
        data: { email: 'ent-test-noprofile@example.com', password: 'x', name: 'No Profile', role: 'PUBLIC', isActive: true, emailVerified: new Date() },
      });

      const result = await resolveOrganizerProfile(user.id);
      expect(result).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════
// ERROR CONTRACT TESTS
// ═══════════════════════════════════════════

describe('Phase 4B — Entitlement Error Contract', () => {
  it('all error codes are defined', () => {
    expect(ENTITLEMENT_ERROR_CODES.ORGANIZER_SUSPENDED).toBe('ORGANIZER_SUSPENDED');
    expect(ENTITLEMENT_ERROR_CODES.ORGANIZER_DEACTIVATED).toBe('ORGANIZER_DEACTIVATED');
    expect(ENTITLEMENT_ERROR_CODES.ORGANIZER_NOT_OPERABLE).toBe('ORGANIZER_NOT_OPERABLE');
    expect(ENTITLEMENT_ERROR_CODES.SUBSCRIPTION_REQUIRED).toBe('SUBSCRIPTION_REQUIRED');
    expect(ENTITLEMENT_ERROR_CODES.SUBSCRIPTION_EXPIRED).toBe('SUBSCRIPTION_EXPIRED');
    expect(ENTITLEMENT_ERROR_CODES.FEATURE_NOT_AVAILABLE).toBe('FEATURE_NOT_AVAILABLE');
    expect(ENTITLEMENT_ERROR_CODES.PLAN_LIMIT_REACHED).toBe('PLAN_LIMIT_REACHED');
  });

  it('entitlement errors use ApiError class with valid JSON structure', () => {
    try {
      requireWithinLimit(5, 5, 'test', 'test');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      const json = apiErr.toJSON();
      expect(json.success).toBe(false);
      expect(json.error).toHaveProperty('code', 'PLAN_LIMIT_REACHED');
      expect(json.error).toHaveProperty('message');
      expect(json.error).toHaveProperty('details');
    }
  });

  it('limit errors include usage information in details', () => {
    try {
      requireWithinLimit(10, 10, 'events', 'free');
    } catch (err) {
      const details = (err as ApiError).details as Record<string, unknown>;
      expect(details).toHaveProperty('current', 10);
      expect(details).toHaveProperty('max', 10);
      expect(details).toHaveProperty('remaining', 0);
      expect(details).toHaveProperty('planSlug', 'free');
    }
  });

  it('feature errors include feature name and plan slug', () => {
    const e: OrganizerEntitlements = {
      organizerId: 'test', organizerStatus: 'ACTIVE', isOperable: true,
      subscriptionStatus: 'ACTIVE', isEntitled: true, isInTrial: false,
      planSlug: 'free', planName: 'Free',
      limits: { maxEvents: 3, maxTicketsPerEvent: 50, maxTicketTypesPerEvent: 2, maxStaff: 0, maxMediaPerEvent: 3, maxAttendeesTotal: 500, canAdvertise: false, canCustomBranding: false, canApiAccess: false, analyticsLevel: 'BASIC', trialDays: 0, currency: 'GHS' },
    };
    try {
      requireFeature(e, 'canAdvertise');
    } catch (err) {
      const details = (err as ApiError).details as Record<string, unknown>;
      expect(details).toHaveProperty('feature', 'canAdvertise');
      expect(details).toHaveProperty('currentPlan', 'free');
    }
  });
});
