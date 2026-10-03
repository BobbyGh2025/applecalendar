/**
 * Phase 5E Stage 2: Payment State Machine
 *
 * Authoritative definition and enforcement of legal payment status transitions.
 * All payment status changes MUST go through this service.
 * No route or service may update Payment.status directly through Prisma
 * without first validating the transition here.
 *
 * Legal transitions:
 *   PENDING    → PROCESSING | CANCELLED | EXPIRED
 *   PROCESSING → COMPLETED  | FAILED    | EXPIRED
 *   COMPLETED  → REFUNDED
 *
 * Terminal states (no outgoing transitions):
 *   FAILED, CANCELLED, EXPIRED, REFUNDED
 *
 * Timestamp mapping:
 *   → PROCESSING : processedAt
 *   → COMPLETED  : completedAt
 *   → FAILED     : failedAt
 *   → CANCELLED  : cancelledAt
 *   → EXPIRED    : (no dedicated field; booking.expiresAt serves this purpose)
 *   → REFUNDED   : (original completedAt preserved; Refund.processedAt records refund time)
 */

import { paymentStatuses } from '@/lib/validations/common';
import { InvalidPaymentTransition, PaymentDomainError } from './payment-domain-errors';

// ─── Types ───

export type PaymentStatus = (typeof paymentStatuses)[number];

/** Structured result from a successful state transition */
export interface PaymentTransitionResult {
  from: PaymentStatus;
  to: PaymentStatus;
  timestamp: Date;
  /** Prisma data fields to set for this transition (e.g., completedAt) */
  timestampFields: Record<string, Date>;
}

// ─── Transition Map ───

/**
 * Legal state transitions.
 * Key = current status, Value = Set of allowed target statuses.
 */
const LEGAL_TRANSITIONS: Map<PaymentStatus, Set<PaymentStatus>> = new Map([
  ['PENDING', new Set(['PROCESSING', 'CANCELLED', 'EXPIRED'])],
  ['PROCESSING', new Set(['COMPLETED', 'FAILED', 'EXPIRED'])],
  ['COMPLETED', new Set(['REFUNDED'])],
  // Terminal states — no outgoing transitions
  ['FAILED', new Set()],
  ['CANCELLED', new Set()],
  ['EXPIRED', new Set()],
  ['REFUNDED', new Set()],
]);

// ─── Timestamp Field Mapping ───

/**
 * Returns the Prisma timestamp field name(s) that should be set
 * when transitioning TO the given status.
 */
function getTimestampFieldsForTransition(to: PaymentStatus): Record<string, Date> {
  const now = new Date();
  switch (to) {
    case 'PROCESSING':
      return { processedAt: now };
    case 'COMPLETED':
      return { completedAt: now };
    case 'FAILED':
      return { failedAt: now };
    case 'CANCELLED':
      return { cancelledAt: now };
    // EXPIRED: no dedicated payment timestamp field; booking.expiresAt is used
    // REFUNDED: the original completedAt is preserved; Refund.processedAt records refund time
    case 'EXPIRED':
    case 'REFUNDED':
      return {};
    default:
      return {};
  }
}

// ─── Core: Validate Transition ───

/**
 * Validate that a payment status transition is legal.
 *
 * @param from - Current payment status
 * @param to   - Target payment status
 * @returns PaymentTransitionResult with the new status and timestamp fields
 * @throws InvalidPaymentTransition if the transition is illegal
 */
export function validatePaymentTransition(from: string, to: string): PaymentTransitionResult {
  // Validate that 'from' is a known status
  if (!paymentStatuses.includes(from as PaymentStatus)) {
    throw new PaymentDomainError(
      'UNKNOWN_PAYMENT_STATUS',
      `Unknown payment status: "${from}"`,
      400,
      { from, to },
    );
  }

  // Validate that 'to' is a known status
  if (!paymentStatuses.includes(to as PaymentStatus)) {
    throw new PaymentDomainError(
      'UNKNOWN_PAYMENT_STATUS',
      `Unknown payment status: "${to}"`,
      400,
      { from, to },
    );
  }

  // Same-status "transition" — idempotent, not an error but not a real transition
  if (from === to) {
    return {
      from: from as PaymentStatus,
      to: to as PaymentStatus,
      timestamp: new Date(),
      timestampFields: {},
    };
  }

  const allowedTargets = LEGAL_TRANSITIONS.get(from as PaymentStatus);

  if (!allowedTargets || !allowedTargets.has(to as PaymentStatus)) {
    throw new InvalidPaymentTransition(from, to, getTransitionRejectionReason(from, to));
  }

  return {
    from: from as PaymentStatus,
    to: to as PaymentStatus,
    timestamp: new Date(),
    timestampFields: getTimestampFieldsForTransition(to as PaymentStatus),
  };
}

// ─── Rejection Reason Messages ───

function getTransitionRejectionReason(from: string, to: string): string {
  const terminalStates = ['FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'];
  if (terminalStates.includes(from)) {
    return `${from} is a terminal state — no further transitions are allowed.`;
  }
  if (from === 'COMPLETED' && to !== 'REFUNDED') {
    return 'A completed payment can only transition to REFUNDED.';
  }
  return 'This transition is not defined in the payment state machine.';
}

// ─── Query: Is Transition Legal? ───

/**
 * Check whether a transition is legal without throwing.
 * Useful for conditional logic and tests.
 */
export function isTransitionAllowed(from: string, to: string): boolean {
  try {
    validatePaymentTransition(from, to);
    return true;
  } catch {
    return false;
  }
}

// ─── Query: Get Allowed Transitions ───

/**
 * Get all allowed target statuses from a given current status.
 */
export function getAllowedTransitions(from: PaymentStatus): PaymentStatus[] {
  const allowed = LEGAL_TRANSITIONS.get(from);
  return allowed ? Array.from(allowed) : [];
}

// ─── Query: Is Terminal State? ───

/**
 * Check if a status is terminal (no outgoing transitions).
 */
export function isTerminalStatus(status: PaymentStatus): boolean {
  const allowed = LEGAL_TRANSITIONS.get(status);
  return !allowed || allowed.size === 0;
}

// ─── Query: Can Payment Be Refunded? ───

/**
 * Check if a payment with the given status is eligible for refund.
 * Only COMPLETED payments can be refunded.
 */
export function canBeRefunded(status: PaymentStatus): boolean {
  return status === 'COMPLETED';
}

// ─── Query: Can Payment Be Expired? ───

/**
 * Check if a payment with the given status can be expired.
 * PENDING and PROCESSING payments can be expired.
 */
export function canBeExpired(status: PaymentStatus): boolean {
  return status === 'PENDING' || status === 'PROCESSING';
}
