/**
 * Phase 4C: Organizer Lifecycle Management Service
 *
 * Centralized service for managing organizer profile lifecycle transitions.
 * All status changes must go through this service to ensure:
 * - Only legal state transitions are allowed
 * - Audit log entries are created atomically
 * - Notifications are sent to affected organizers
 * - Backward-compatible approvalStatus is kept in sync
 */

import { db } from '@/lib/db';
import { ApiError } from '@/lib/errors';

// ─── Types ───

/** Organizer lifecycle status values — matches schema OrganizerProfile.status */
export type OrganizerLifecycleStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'DEACTIVATED';

/** Lifecycle action names — used in AuditLog.action and API calls */
export type LifecycleAction =
  | 'ORGANIZER_APPROVED'
  | 'ORGANIZER_REJECTED'
  | 'ORGANIZER_SUSPENDED'
  | 'ORGANIZER_REINSTATED'
  | 'ORGANIZER_DEACTIVATED';

/** Exported action constants for use in routes and tests */
export const ORGANIZER_APPROVED: LifecycleAction = 'ORGANIZER_APPROVED';
export const ORGANIZER_REJECTED: LifecycleAction = 'ORGANIZER_REJECTED';
export const ORGANIZER_SUSPENDED: LifecycleAction = 'ORGANIZER_SUSPENDED';
export const ORGANIZER_REINSTATED: LifecycleAction = 'ORGANIZER_REINSTATED';
export const ORGANIZER_DEACTIVATED: LifecycleAction = 'ORGANIZER_DEACTIVATED';

// ─── State Transition Map ───

/**
 * Legal state transitions.
 * Key = current status, Value = Map of action → new status.
 *
 * APPROVED is treated as an operable state similar to ACTIVE
 * (per Phase 4B entitlement logic where APPROVED is operable).
 */
const TRANSITIONS = new Map<string, Map<LifecycleAction, OrganizerLifecycleStatus>>([
  [
    'PENDING_APPROVAL',
    new Map<LifecycleAction, OrganizerLifecycleStatus>([
      [ORGANIZER_APPROVED, 'ACTIVE'],
      [ORGANIZER_REJECTED, 'REJECTED'],
    ]),
  ],
  [
    'APPROVED',
    new Map<LifecycleAction, OrganizerLifecycleStatus>([
      [ORGANIZER_APPROVED, 'ACTIVE'],
      [ORGANIZER_REJECTED, 'REJECTED'],
      [ORGANIZER_SUSPENDED, 'SUSPENDED'],
      [ORGANIZER_DEACTIVATED, 'DEACTIVATED'],
    ]),
  ],
  [
    'ACTIVE',
    new Map<LifecycleAction, OrganizerLifecycleStatus>([
      [ORGANIZER_SUSPENDED, 'SUSPENDED'],
      [ORGANIZER_DEACTIVATED, 'DEACTIVATED'],
    ]),
  ],
  [
    'SUSPENDED',
    new Map<LifecycleAction, OrganizerLifecycleStatus>([
      [ORGANIZER_REINSTATED, 'ACTIVE'],
      [ORGANIZER_DEACTIVATED, 'DEACTIVATED'],
    ]),
  ],
  [
    'REJECTED',
    new Map<LifecycleAction, OrganizerLifecycleStatus>([
      [ORGANIZER_DEACTIVATED, 'DEACTIVATED'],
    ]),
  ],
  // DEACTIVATED is a terminal state — no transitions out
]);

// ─── Transition Validation ───

/**
 * Validate that a lifecycle transition is legal.
 *
 * @param currentStatus - The organizer's current status
 * @param action - The requested lifecycle action
 * @returns The new status if the transition is legal
 * @throws ApiError with code INVALID_STATUS_TRANSITION if illegal
 */
export function validateTransition(
  currentStatus: string,
  action: LifecycleAction,
): OrganizerLifecycleStatus {
  const currentTransitions = TRANSITIONS.get(currentStatus);

  if (!currentTransitions) {
    throw new ApiError(
      409,
      'INVALID_STATUS_TRANSITION',
      `Cannot transition from status "${currentStatus}"`,
      { currentStatus, action },
    );
  }

  const newStatus = currentTransitions.get(action);

  if (!newStatus) {
    throw new ApiError(
      409,
      'INVALID_STATUS_TRANSITION',
      `Cannot ${action} an organizer with status "${currentStatus}"`,
      { currentStatus, action },
    );
  }

  return newStatus;
}

// ─── Actions that require a reason ───

const REASON_REQUIRED_ACTIONS: Set<LifecycleAction> = new Set([
  ORGANIZER_REJECTED,
  ORGANIZER_SUSPENDED,
  ORGANIZER_DEACTIVATED,
]);

// ─── Backward compat: approvalStatus mapping ───

function getApprovalStatusForNewStatus(newStatus: OrganizerLifecycleStatus): string | null {
  if (newStatus === 'ACTIVE') return 'APPROVED';
  if (newStatus === 'REJECTED') return 'REJECTED';
  return null;
}

// ─── Notification helpers ───

function getNotificationForAction(
  action: LifecycleAction,
  organizationName: string,
  reason?: string,
): { title: string; message: string } {
  const reasonSuffix = reason ? ` Reason: ${reason}` : '';

  if (action === ORGANIZER_APPROVED) {
    return {
      title: 'Organizer Profile Approved',
      message: `Your organizer profile "${organizationName}" has been approved. You can now publish events.`,
    };
  }
  if (action === ORGANIZER_REJECTED) {
    return {
      title: 'Organizer Profile Rejected',
      message: `Your organizer profile "${organizationName}" has been rejected.${reasonSuffix}`,
    };
  }
  if (action === ORGANIZER_SUSPENDED) {
    return {
      title: 'Organizer Profile Suspended',
      message: `Your organizer profile "${organizationName}" has been suspended.${reasonSuffix}`,
    };
  }
  if (action === ORGANIZER_REINSTATED) {
    return {
      title: 'Organizer Profile Reinstated',
      message: `Your organizer profile "${organizationName}" has been reinstated and is now active.`,
    };
  }
  // ORGANIZER_DEACTIVATED
  return {
    title: 'Organizer Profile Deactivated',
    message: `Your organizer profile "${organizationName}" has been deactivated.${reasonSuffix}`,
  };
}

// ─── Result types ───

export interface OrganizerProfileResult {
  id: string;
  userId: string;
  organizationName: string;
  slug: string;
  description: string | null;
  logo: string | null;
  coverImage: string | null;
  website: string | null;
  contactEmail: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  socialLinks: string | null;
  isVerified: boolean;
  approvalStatus: string;
  status: string;
  statusReason: string | null;
  statusChangedBy: string | null;
  statusChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogResult {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  createdAt: Date;
}

// ─── Core: Execute Lifecycle Transition ───

/**
 * Execute an organizer lifecycle transition atomically.
 *
 * Steps:
 * 1. Load the organizer profile from DB
 * 2. Validate the transition is legal
 * 3. Require a reason for reject/suspend/deactivate actions
 * 4. In a Prisma $transaction:
 *    a. Update OrganizerProfile (status, statusReason, statusChangedBy, statusChangedAt, approvalStatus)
 *    b. Create an AuditLog entry
 * 5. Create a Notification for the organizer user
 * 6. Return the updated profile and audit log
 */
export async function executeLifecycleTransition(params: {
  organizerId: string;
  action: LifecycleAction;
  actorId: string;
  reason?: string;
}): Promise<{ profile: OrganizerProfileResult; auditLog: AuditLogResult }> {
  const { organizerId, action, actorId, reason } = params;

  // 1. Load the organizer profile
  const profile = await db.organizerProfile.findUnique({
    where: { id: organizerId },
    select: {
      id: true,
      userId: true,
      organizationName: true,
      slug: true,
      description: true,
      logo: true,
      coverImage: true,
      website: true,
      contactEmail: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      country: true,
      socialLinks: true,
      isVerified: true,
      approvalStatus: true,
      status: true,
      statusReason: true,
      statusChangedBy: true,
      statusChangedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!profile) {
    throw new ApiError(404, 'NOT_FOUND', 'Organizer profile not found');
  }

  // 2. Validate the transition
  const previousStatus = profile.status;
  const newStatus = validateTransition(previousStatus, action);

  // 3. Require reason for reject/suspend/deactivate
  if (REASON_REQUIRED_ACTIONS.has(action) && (!reason || reason.trim() === '')) {
    throw new ApiError(
      400,
      'REASON_REQUIRED',
      `A reason is required when ${action === ORGANIZER_REJECTED ? 'rejecting' : action === ORGANIZER_SUSPENDED ? 'suspending' : 'deactivating'} an organizer`,
      { action },
    );
  }

  // 4. Compute backward-compatible approvalStatus
  const newApprovalStatus = getApprovalStatusForNewStatus(newStatus);

  const now = new Date();

  // 5. Atomic transaction: update profile + create audit log
  const [updatedProfile, auditLog] = await db.$transaction([
    db.organizerProfile.update({
      where: { id: organizerId },
      data: {
        status: newStatus,
        statusReason: reason ?? null,
        statusChangedBy: actorId,
        statusChangedAt: now,
        ...(newApprovalStatus !== null && { approvalStatus: newApprovalStatus }),
      },
      select: {
        id: true,
        userId: true,
        organizationName: true,
        slug: true,
        description: true,
        logo: true,
        coverImage: true,
        website: true,
        contactEmail: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        country: true,
        socialLinks: true,
        isVerified: true,
        approvalStatus: true,
        status: true,
        statusReason: true,
        statusChangedBy: true,
        statusChangedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.auditLog.create({
      data: {
        actorId,
        action,
        entityType: 'OrganizerProfile',
        entityId: organizerId,
        oldValue: JSON.stringify({ status: previousStatus }),
        newValue: JSON.stringify({ status: newStatus }),
        reason: reason ?? null,
      },
      select: {
        id: true,
        actorId: true,
        action: true,
        entityType: true,
        entityId: true,
        oldValue: true,
        newValue: true,
        reason: true,
        createdAt: true,
      },
    }),
  ]);

  // 6. Create notification for the organizer user
  const notification = getNotificationForAction(action, profile.organizationName, reason);
  await db.notification.create({
    data: {
      userId: profile.userId,
      title: notification.title,
      message: notification.message,
      type: 'SYSTEM',
    },
  });

  return {
    profile: updatedProfile as OrganizerProfileResult,
    auditLog: auditLog as AuditLogResult,
  };
}
