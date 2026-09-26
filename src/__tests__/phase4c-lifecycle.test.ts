/**
 * Phase 4C Tests: Organizer Lifecycle Management
 *
 * Tests cover:
 * - State transition validation (legal and illegal transitions)
 * - Lifecycle execution with audit logging
 * - Reason requirements for reject/suspend/deactivate
 * - Entitlement integration (suspended/deactivated organizers blocked)
 * - Error contracts (machine-readable codes)
 * - Backward-compatible approvalStatus sync
 * - Notification creation
 * - Organizer profile creation defaults to PENDING_APPROVAL
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  validateTransition,
  executeLifecycleTransition,
  ORGANIZER_APPROVED,
  ORGANIZER_REJECTED,
  ORGANIZER_SUSPENDED,
  ORGANIZER_REINSTATED,
  ORGANIZER_DEACTIVATED,
} from '@/lib/services/organizer-lifecycle';
import {
  getOrganizerEntitlements,
  requireOperableOrganizer,
  _invalidateFreePlanCache,
} from '@/lib/services/entitlements';
import { ApiError } from '@/lib/errors';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

// ─── Test Data ───
let superAdminId: string;
let pendingOrgUserId: string;
let pendingOrgProfileId: string;
let activeOrgUserId: string;
let activeOrgProfileId: string;
let suspendedOrgUserId: string;
let suspendedOrgProfileId: string;
let rejectedOrgUserId: string;
let rejectedOrgProfileId: string;
let deactivatedOrgUserId: string;
let deactivatedOrgProfileId: string;

// ─── State Transition Validation (pure logic, no DB) ───

describe('Phase 4C — State Transition Validation', () => {
  describe('Legal transitions', () => {
    it('should allow PENDING_APPROVAL → ACTIVE (approve)', () => {
      expect(validateTransition('PENDING_APPROVAL', ORGANIZER_APPROVED)).toBe('ACTIVE');
    });

    it('should allow PENDING_APPROVAL → REJECTED (reject)', () => {
      expect(validateTransition('PENDING_APPROVAL', ORGANIZER_REJECTED)).toBe('REJECTED');
    });

    it('should allow ACTIVE → SUSPENDED (suspend)', () => {
      expect(validateTransition('ACTIVE', ORGANIZER_SUSPENDED)).toBe('SUSPENDED');
    });

    it('should allow ACTIVE → DEACTIVATED (deactivate)', () => {
      expect(validateTransition('ACTIVE', ORGANIZER_DEACTIVATED)).toBe('DEACTIVATED');
    });

    it('should allow SUSPENDED → ACTIVE (reinstate)', () => {
      expect(validateTransition('SUSPENDED', ORGANIZER_REINSTATED)).toBe('ACTIVE');
    });

    it('should allow SUSPENDED → DEACTIVATED (deactivate)', () => {
      expect(validateTransition('SUSPENDED', ORGANIZER_DEACTIVATED)).toBe('DEACTIVATED');
    });

    it('should allow REJECTED → DEACTIVATED (deactivate)', () => {
      expect(validateTransition('REJECTED', ORGANIZER_DEACTIVATED)).toBe('DEACTIVATED');
    });

    it('should allow APPROVED → ACTIVE (approve)', () => {
      expect(validateTransition('APPROVED', ORGANIZER_APPROVED)).toBe('ACTIVE');
    });

    it('should allow APPROVED → REJECTED (reject)', () => {
      expect(validateTransition('APPROVED', ORGANIZER_REJECTED)).toBe('REJECTED');
    });

    it('should allow APPROVED → SUSPENDED (suspend)', () => {
      expect(validateTransition('APPROVED', ORGANIZER_SUSPENDED)).toBe('SUSPENDED');
    });

    it('should allow APPROVED → DEACTIVATED (deactivate)', () => {
      expect(validateTransition('APPROVED', ORGANIZER_DEACTIVATED)).toBe('DEACTIVATED');
    });
  });

  describe('Illegal transitions', () => {
    it('should reject DEACTIVATED → ACTIVE (terminal state)', () => {
      expect(() => validateTransition('DEACTIVATED', ORGANIZER_APPROVED)).toThrow();
    });

    it('should reject DEACTIVATED → REINSTATED', () => {
      expect(() => validateTransition('DEACTIVATED', ORGANIZER_REINSTATED)).toThrow();
    });

    it('should reject ACTIVE → APPROVE (already active)', () => {
      expect(() => validateTransition('ACTIVE', ORGANIZER_APPROVED)).toThrow();
    });

    it('should reject SUSPENDED → REJECTED', () => {
      expect(() => validateTransition('SUSPENDED', ORGANIZER_REJECTED)).toThrow();
    });

    it('should reject REJECTED → REINSTATE', () => {
      expect(() => validateTransition('REJECTED', ORGANIZER_REINSTATED)).toThrow();
    });

    it('should reject PENDING_APPROVAL → SUSPENDED', () => {
      expect(() => validateTransition('PENDING_APPROVAL', ORGANIZER_SUSPENDED)).toThrow();
    });

    it('should reject PENDING_APPROVAL → DEACTIVATED', () => {
      expect(() => validateTransition('PENDING_APPROVAL', ORGANIZER_DEACTIVATED)).toThrow();
    });

    it('should throw ApiError with INVALID_STATUS_TRANSITION code', () => {
      try {
        validateTransition('DEACTIVATED', ORGANIZER_APPROVED);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('INVALID_STATUS_TRANSITION');
        expect((error as ApiError).statusCode).toBe(409);
      }
    });

    it('should include current status and action in error details', () => {
      try {
        validateTransition('DEACTIVATED', ORGANIZER_APPROVED);
        expect.fail('Should have thrown');
      } catch (error) {
        const details = (error as ApiError).details as Record<string, string>;
        expect(details.currentStatus).toBe('DEACTIVATED');
        expect(details.action).toBe('ORGANIZER_APPROVED');
      }
    });
  });
});

// ─── Lifecycle Execution with Database ───

describe('Phase 4C — Lifecycle Execution (DB)', () => {
  beforeAll(async () => {
    _invalidateFreePlanCache();

    const saPassword = await hash('AdminPass2025!', 12);
    const sa = await prisma.user.upsert({
      where: { email: 'lifecycle-admin@test.com' },
      update: {},
      create: { email: 'lifecycle-admin@test.com', password: saPassword, name: 'Lifecycle Admin', role: 'SUPER_ADMIN', isActive: true },
    });
    superAdminId = sa.id;

    const pendingPw = await hash('OrgPass2025!', 12);
    const pendingUser = await prisma.user.upsert({
      where: { email: 'lifecycle-pending@test.com' },
      update: {},
      create: { email: 'lifecycle-pending@test.com', password: pendingPw, name: 'Pending Org', role: 'ORGANIZER', isActive: true },
    });
    pendingOrgUserId = pendingUser.id;
    const pendingProfile = await prisma.organizerProfile.upsert({
      where: { userId: pendingUser.id },
      update: { status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', statusReason: null },
      create: { userId: pendingUser.id, organizationName: 'Pending Org LLC', slug: 'pending-org-lifecycle', status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' },
    });
    pendingOrgProfileId = pendingProfile.id;

    const activePw = await hash('OrgPass2025!', 12);
    const activeUser = await prisma.user.upsert({
      where: { email: 'lifecycle-active@test.com' },
      update: {},
      create: { email: 'lifecycle-active@test.com', password: activePw, name: 'Active Org', role: 'ORGANIZER', isActive: true },
    });
    activeOrgUserId = activeUser.id;
    const activeProfile = await prisma.organizerProfile.upsert({
      where: { userId: activeUser.id },
      update: { status: 'ACTIVE', approvalStatus: 'APPROVED', statusReason: null },
      create: { userId: activeUser.id, organizationName: 'Active Org LLC', slug: 'active-org-lifecycle', status: 'ACTIVE', approvalStatus: 'APPROVED' },
    });
    activeOrgProfileId = activeProfile.id;

    const suspPw = await hash('OrgPass2025!', 12);
    const suspUser = await prisma.user.upsert({
      where: { email: 'lifecycle-suspended@test.com' },
      update: {},
      create: { email: 'lifecycle-suspended@test.com', password: suspPw, name: 'Suspended Org', role: 'ORGANIZER', isActive: true },
    });
    suspendedOrgUserId = suspUser.id;
    const suspProfile = await prisma.organizerProfile.upsert({
      where: { userId: suspUser.id },
      update: { status: 'SUSPENDED', statusReason: 'Test suspension', approvalStatus: 'APPROVED' },
      create: { userId: suspUser.id, organizationName: 'Suspended Org LLC', slug: 'suspended-org-lifecycle', status: 'SUSPENDED', statusReason: 'Test suspension', approvalStatus: 'APPROVED' },
    });
    suspendedOrgProfileId = suspProfile.id;

    const rejPw = await hash('OrgPass2025!', 12);
    const rejUser = await prisma.user.upsert({
      where: { email: 'lifecycle-rejected@test.com' },
      update: {},
      create: { email: 'lifecycle-rejected@test.com', password: rejPw, name: 'Rejected Org', role: 'ORGANIZER', isActive: true },
    });
    rejectedOrgUserId = rejUser.id;
    const rejProfile = await prisma.organizerProfile.upsert({
      where: { userId: rejUser.id },
      update: { status: 'REJECTED', statusReason: 'Test rejection', approvalStatus: 'REJECTED' },
      create: { userId: rejUser.id, organizationName: 'Rejected Org LLC', slug: 'rejected-org-lifecycle', status: 'REJECTED', statusReason: 'Test rejection', approvalStatus: 'REJECTED' },
    });
    rejectedOrgProfileId = rejProfile.id;

    const deactPw = await hash('OrgPass2025!', 12);
    const deactUser = await prisma.user.upsert({
      where: { email: 'lifecycle-deactivated@test.com' },
      update: {},
      create: { email: 'lifecycle-deactivated@test.com', password: deactPw, name: 'Deactivated Org', role: 'ORGANIZER', isActive: true },
    });
    deactivatedOrgUserId = deactUser.id;
    const deactProfile = await prisma.organizerProfile.upsert({
      where: { userId: deactUser.id },
      update: { status: 'DEACTIVATED', statusReason: 'Test deactivation', approvalStatus: 'PENDING' },
      create: { userId: deactUser.id, organizationName: 'Deactivated Org LLC', slug: 'deactivated-org-lifecycle', status: 'DEACTIVATED', statusReason: 'Test deactivation', approvalStatus: 'PENDING' },
    });
    deactivatedOrgProfileId = deactProfile.id;
  });

  describe('Approve organizer', () => {
    it('should transition PENDING_APPROVAL → ACTIVE', async () => {
      const result = await executeLifecycleTransition({
        organizerId: pendingOrgProfileId,
        action: ORGANIZER_APPROVED,
        actorId: superAdminId,
      });
      expect(result.profile.status).toBe('ACTIVE');
      expect(result.profile.approvalStatus).toBe('APPROVED');
      expect(result.profile.statusChangedBy).toBe(superAdminId);
      expect(result.profile.statusChangedAt).toBeDefined();
    });

    it('should create an audit log entry', async () => {
      const auditLogs = await prisma.auditLog.findMany({
        where: { entityId: pendingOrgProfileId, action: 'ORGANIZER_APPROVED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0].actorId).toBe(superAdminId);
      expect(auditLogs[0].entityType).toBe('OrganizerProfile');
      expect(auditLogs[0].oldValue).toContain('PENDING_APPROVAL');
      expect(auditLogs[0].newValue).toContain('ACTIVE');
    });

    it('should create a notification for the organizer', async () => {
      const notifications = await prisma.notification.findMany({
        where: { userId: pendingOrgUserId, title: 'Organizer Profile Approved' },
      });
      expect(notifications.length).toBeGreaterThan(0);
    });
  });

  describe('Reject organizer', () => {
    it('should require a reason', async () => {
      const rejPw = await hash('OrgPass2025!', 12);
      const rejUser = await prisma.user.upsert({
        where: { email: 'lifecycle-reject-noreason@test.com' },
        update: {},
        create: { email: 'lifecycle-reject-noreason@test.com', password: rejPw, name: 'Reject NoReason', role: 'ORGANIZER', isActive: true },
      });
      const rejProfile = await prisma.organizerProfile.upsert({
        where: { userId: rejUser.id },
        update: { status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' },
        create: { userId: rejUser.id, organizationName: 'Reject NoReason LLC', slug: 'reject-noreason-lifecycle', status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' },
      });

      try {
        await executeLifecycleTransition({
          organizerId: rejProfile.id,
          action: ORGANIZER_REJECTED,
          actorId: superAdminId,
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('REASON_REQUIRED');
        expect((error as ApiError).statusCode).toBe(400);
      }
    });

    it('should transition PENDING_APPROVAL → REJECTED with reason', async () => {
      const rejPw = await hash('OrgPass2025!', 12);
      const rejUser = await prisma.user.upsert({
        where: { email: 'lifecycle-reject-valid@test.com' },
        update: {},
        create: { email: 'lifecycle-reject-valid@test.com', password: rejPw, name: 'Reject Valid Org', role: 'ORGANIZER', isActive: true },
      });
      const rejProfile = await prisma.organizerProfile.upsert({
        where: { userId: rejUser.id },
        update: { status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' },
        create: { userId: rejUser.id, organizationName: 'Reject Valid LLC', slug: 'reject-valid-lifecycle', status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' },
      });

      const result = await executeLifecycleTransition({
        organizerId: rejProfile.id,
        action: ORGANIZER_REJECTED,
        actorId: superAdminId,
        reason: 'Insufficient documentation',
      });

      expect(result.profile.status).toBe('REJECTED');
      expect(result.profile.statusReason).toBe('Insufficient documentation');
      expect(result.profile.approvalStatus).toBe('REJECTED');
      expect(result.auditLog.reason).toBe('Insufficient documentation');
    });
  });

  describe('Suspend organizer', () => {
    it('should require a reason', async () => {
      try {
        await executeLifecycleTransition({
          organizerId: activeOrgProfileId,
          action: ORGANIZER_SUSPENDED,
          actorId: superAdminId,
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('REASON_REQUIRED');
      }
    });

    it('should transition ACTIVE → SUSPENDED with reason', async () => {
      const result = await executeLifecycleTransition({
        organizerId: activeOrgProfileId,
        action: ORGANIZER_SUSPENDED,
        actorId: superAdminId,
        reason: 'Terms of service violation',
      });

      expect(result.profile.status).toBe('SUSPENDED');
      expect(result.profile.statusReason).toBe('Terms of service violation');
      expect(result.auditLog.action).toBe('ORGANIZER_SUSPENDED');
      expect(result.auditLog.oldValue).toContain('ACTIVE');
      expect(result.auditLog.newValue).toContain('SUSPENDED');
    });
  });

  describe('Reinstate organizer', () => {
    it('should transition SUSPENDED → ACTIVE', async () => {
      const result = await executeLifecycleTransition({
        organizerId: suspendedOrgProfileId,
        action: ORGANIZER_REINSTATED,
        actorId: superAdminId,
      });

      expect(result.profile.status).toBe('ACTIVE');
      expect(result.profile.approvalStatus).toBe('APPROVED');
      expect(result.auditLog.action).toBe('ORGANIZER_REINSTATED');
    });
  });

  describe('Deactivate organizer', () => {
    it('should require a reason', async () => {
      try {
        await executeLifecycleTransition({
          organizerId: rejectedOrgProfileId,
          action: ORGANIZER_DEACTIVATED,
          actorId: superAdminId,
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('REASON_REQUIRED');
      }
    });

    it('should transition REJECTED → DEACTIVATED with reason', async () => {
      const result = await executeLifecycleTransition({
        organizerId: rejectedOrgProfileId,
        action: ORGANIZER_DEACTIVATED,
        actorId: superAdminId,
        reason: 'Account closure requested',
      });

      expect(result.profile.status).toBe('DEACTIVATED');
      expect(result.profile.statusReason).toBe('Account closure requested');
      expect(result.auditLog.action).toBe('ORGANIZER_DEACTIVATED');
    });
  });

  describe('Invalid transitions with DB', () => {
    it('should reject DEACTIVATED → ACTIVE', async () => {
      try {
        await executeLifecycleTransition({
          organizerId: deactivatedOrgProfileId,
          action: ORGANIZER_APPROVED,
          actorId: superAdminId,
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('INVALID_STATUS_TRANSITION');
      }
    });

    it('should reject non-existent organizer', async () => {
      try {
        await executeLifecycleTransition({
          organizerId: 'nonexistent-id',
          action: ORGANIZER_APPROVED,
          actorId: superAdminId,
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('Audit log integrity', () => {
    it('should never store secrets in audit log', async () => {
      const auditLogs = await prisma.auditLog.findMany({
        where: { entityType: 'OrganizerProfile' },
        select: { oldValue: true, newValue: true, reason: true },
      });

      for (const log of auditLogs) {
        const combined = `${log.oldValue || ''}${log.newValue || ''}${log.reason || ''}`;
        expect(combined).not.toContain('password');
        expect(combined).not.toContain('JWT');
      }
    });

    it('should record actor and entity for all lifecycle audits', async () => {
      const lifecycleAudits = await prisma.auditLog.findMany({
        where: {
          entityType: 'OrganizerProfile',
          action: {
            in: ['ORGANIZER_APPROVED', 'ORGANIZER_REJECTED', 'ORGANIZER_SUSPENDED', 'ORGANIZER_REINSTATED', 'ORGANIZER_DEACTIVATED'],
          },
        },
      });

      for (const audit of lifecycleAudits) {
        expect(audit.actorId).toBeDefined();
        expect(audit.entityId).toBeDefined();
        expect(audit.entityType).toBe('OrganizerProfile');
      }
    });
  });
});

// ─── Entitlement Integration ───

describe('Phase 4C — Entitlement Integration', () => {
  it('should block DEACTIVATED organizer from operable entitlements', async () => {
    try {
      const entitlements = await getOrganizerEntitlements(deactivatedOrgUserId);
      requireOperableOrganizer(entitlements);
      expect.fail('Should have thrown for deactivated organizer');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('ORGANIZER_DEACTIVATED');
    }
  });

  it('should block REJECTED organizer from operable entitlements', async () => {
    // Create a fresh rejected organizer for this test
    const rejPw = await hash('OrgPass2025!', 12);
    const rejUser = await prisma.user.upsert({
      where: { email: 'lifecycle-entitlement-rejected@test.com' },
      update: {},
      create: { email: 'lifecycle-entitlement-rejected@test.com', password: rejPw, name: 'Entitlement Rejected', role: 'ORGANIZER', isActive: true },
    });
    await prisma.organizerProfile.upsert({
      where: { userId: rejUser.id },
      update: { status: 'REJECTED', approvalStatus: 'REJECTED', statusReason: 'Test' },
      create: { userId: rejUser.id, organizationName: 'Entitlement Rejected LLC', slug: 'entitlement-rejected-lifecycle', status: 'REJECTED', approvalStatus: 'REJECTED', statusReason: 'Test' },
    });

    try {
      const entitlements = await getOrganizerEntitlements(rejUser.id);
      requireOperableOrganizer(entitlements);
      expect.fail('Should have thrown for rejected organizer');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('ORGANIZER_NOT_OPERABLE');
    }
  });

  it('should allow ACTIVE organizer to use operable entitlements', async () => {
    const entitlements = await getOrganizerEntitlements(suspendedOrgUserId);
    expect(entitlements.isOperable).toBe(true);
    requireOperableOrganizer(entitlements);
  });
});

// ─── Organizer Onboarding ───

describe('Phase 4C — Organizer Onboarding', () => {
  it('should default new organizer profile to PENDING_APPROVAL status', async () => {
    const onbPw = await hash('OrgPass2025!', 12);
    const onbUser = await prisma.user.upsert({
      where: { email: 'lifecycle-onboarding@test.com' },
      update: {},
      create: { email: 'lifecycle-onboarding@test.com', password: onbPw, name: 'Onboarding Org', role: 'ORGANIZER', isActive: true },
    });

    const profile = await prisma.organizerProfile.upsert({
      where: { userId: onbUser.id },
      update: {},
      create: {
        userId: onbUser.id,
        organizationName: 'Onboarding LLC',
        slug: 'onboarding-lifecycle',
      },
    });

    expect(profile.status).toBe('PENDING_APPROVAL');
    expect(profile.approvalStatus).toBe('PENDING');
  });
});
