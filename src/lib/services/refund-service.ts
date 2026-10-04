/**
 * Phase 5E Stage 2: Refund Service
 *
 * Central service for managing refund lifecycle.
 *
 * CRITICAL DISTINCTION:
 *   A requested refund is NOT the same as a completed refund.
 *
 * Lifecycle:
 *   REQUESTED → PROCESSING → COMPLETED / FAILED
 *
 * Only a successfully completed FULL refund may result in:
 *   Payment.status = REFUNDED
 *
 * Partial refunds do NOT change Payment.status to REFUNDED.
 * The Payment.refundedAmount accumulates across partial refunds.
 *
 * Invariants:
 *   - Refund amount cannot exceed payment amount
 *   - Only COMPLETED payments can be refunded
 *   - Duplicate refund requests for the same payment are blocked
 *     (only one active refund at a time per payment)
 *   - Payment.refundedAmount is updated atomically on refund completion
 *
 * Provider integration (Stage 3/5):
 *   - requestRefund() calls the provider adapter
 *   - For now, ProviderIntegrationPending is thrown
 */

import { db } from '@/lib/db';
import { validatePaymentTransition } from './payment-state-machine';
import {
  PaymentNotFound,
  RefundNotFound,
  RefundNotEligible,
  RefundAmountExceedsPayment,
  DuplicateRefund,
} from './payment-domain-errors';
import { validateRefundMoneyConstraints } from '@/lib/money-constraints';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface RequestRefundParams {
  paymentId: string;
  /** Refund amount in integer minor units */
  amount: number;
  /** Reason for the refund */
  reason?: string;
  /** User ID requesting the refund */
  requestedBy: string;
}

export interface ProcessRefundCompletionParams {
  refundId: string;
  /** Provider reference for the completed refund */
  providerRef?: string;
}

export interface ProcessRefundFailureParams {
  refundId: string;
  failureReason: string;
}

export interface RefundResult {
  refundId: string;
  status: string;
  amount: number;
  paymentId: string;
}

// ─── Core: Request Refund ───

/**
 * Request a refund for a payment.
 *
 * Validates:
 *   - Payment exists and is COMPLETED
 *   - Refund amount does not exceed payment amount
 *   - No other active refund exists for this payment
 *
 * Creates a Refund record with status REQUESTED.
 * Does NOT change Payment.status — that happens only on full refund completion.
 */
export async function requestRefund(
  params: RequestRefundParams,
): Promise<RefundResult> {
  const { paymentId, amount, reason, requestedBy } = params;

  // 1. Load the payment
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      refundedAmount: true,
    },
  });

  if (!payment) {
    throw new PaymentNotFound(paymentId);
  }

  // 2. Payment must be COMPLETED to be refundable
  if (payment.status !== 'COMPLETED') {
    throw new RefundNotEligible(
      paymentId,
      `Payment status is ${payment.status}, but only COMPLETED payments can be refunded.`,
    );
  }

  // 3. Validate refund amount
  validateRefundMoneyConstraints({ amount, paymentAmount: payment.amount });

  // Check that refund doesn't exceed remaining refundable amount
  const remainingRefundable = payment.amount - payment.refundedAmount;
  if (amount > remainingRefundable) {
    throw new RefundAmountExceedsPayment(amount, remainingRefundable);
  }

  // 4-5. Atomic: check for duplicate active refund + create new refund
  // Must be in a transaction to prevent TOCTOU race: two concurrent requests
  // could both pass the duplicate check and both create refunds.
  const refund = await db.$transaction(async (tx) => {
    // Check for duplicate active refund (REQUESTED or PROCESSING)
    const activeRefund = await tx.refund.findFirst({
      where: {
        paymentId,
        status: { in: ['REQUESTED', 'PROCESSING'] },
      },
      select: { id: true },
    });

    if (activeRefund) {
      throw new DuplicateRefund(paymentId);
    }

    // Create the Refund record
    return tx.refund.create({
      data: {
        paymentId,
        amount,
        reason: reason ?? null,
        status: 'REQUESTED',
        requestedBy,
      },
      select: {
        id: true,
        status: true,
        amount: true,
        paymentId: true,
      },
    });
  });

  logger.info('Refund requested', {
    refundId: refund.id,
    paymentId,
    amount,
    requestedBy,
  });

  return {
    refundId: refund.id,
    status: refund.status,
    amount: refund.amount,
    paymentId: refund.paymentId,
  };
}

// ─── Core: Process Refund Completion ───

/**
 * Mark a refund as completed after successful provider refund.
 *
 * Atomically:
 *   - Update Refund.status → COMPLETED
 *   - Increment Payment.refundedAmount
 *   - If full refund: transition Payment.status → REFUNDED
 *
 * Idempotent: if refund is already COMPLETED, no-op.
 */
export async function processRefundCompletion(
  params: ProcessRefundCompletionParams,
): Promise<RefundResult> {
  const { refundId, providerRef } = params;

  const refund = await db.refund.findUnique({
    where: { id: refundId },
    include: {
      payment: {
        select: { id: true, amount: true, status: true, refundedAmount: true },
      },
    },
  });

  if (!refund) {
    throw new RefundNotFound(refundId);
  }

  // Idempotent: already completed
  if (refund.status === 'COMPLETED') {
    logger.info('Refund already completed (idempotent)', { refundId });
    return { refundId, status: 'COMPLETED', amount: refund.amount, paymentId: refund.paymentId };
  }

  // Must be in PROCESSING state
  if (refund.status !== 'PROCESSING' && refund.status !== 'REQUESTED') {
    throw new RefundNotEligible(
      refund.paymentId,
      `Refund status is ${refund.status}, expected PROCESSING or REQUESTED.`,
    );
  }

  // Atomic transaction with status guard to prevent double-completion
  await db.$transaction(async (tx) => {
    // 1. Update Refund status — CONDITIONAL on current status being REQUESTED or PROCESSING
    // This prevents two concurrent completions from both succeeding
    const refundUpdate = await tx.refund.updateMany({
      where: {
        id: refundId,
        status: { in: ['REQUESTED', 'PROCESSING'] },
      },
      data: {
        status: 'COMPLETED',
        providerRef: providerRef ?? null,
        processedAt: new Date(),
      },
    });

    if (refundUpdate.count === 0) {
      // Refund was already completed by a concurrent process — idempotent, no-op
      logger.info('Refund already completed by concurrent process (idempotent)', { refundId });
      return;
    }

    // 2. Increment Payment.refundedAmount
    const updatedPayment = await tx.payment.update({
      where: { id: refund.paymentId },
      data: {
        refundedAmount: { increment: refund.amount },
      },
      select: { amount: true, refundedAmount: true, status: true },
    });

    // 3. If full refund (refundedAmount >= amount), transition Payment → REFUNDED
    if (updatedPayment.refundedAmount >= refund.payment.amount && updatedPayment.status === 'COMPLETED') {
      const transition = validatePaymentTransition('COMPLETED', 'REFUNDED');
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: {
          status: 'REFUNDED',
        },
      });
    }
  });

  logger.info('Refund completed', {
    refundId,
    paymentId: refund.paymentId,
    amount: refund.amount,
  });

  return { refundId, status: 'COMPLETED', amount: refund.amount, paymentId: refund.paymentId };
}

// ─── Core: Process Refund Failure ───

/**
 * Mark a refund as failed after provider refund failure.
 * Payment status remains unchanged (COMPLETED).
 */
export async function processRefundFailure(
  params: ProcessRefundFailureParams,
): Promise<RefundResult> {
  const { refundId, failureReason } = params;

  const refund = await db.refund.update({
    where: { id: refundId },
    data: {
      status: 'FAILED',
      failureReason,
    },
    select: {
      id: true,
      status: true,
      amount: true,
      paymentId: true,
    },
  });

  logger.info('Refund failed', { refundId, failureReason, paymentId: refund.paymentId });

  return {
    refundId: refund.id,
    status: refund.status,
    amount: refund.amount,
    paymentId: refund.paymentId,
  };
}

// ─── Core: Transition Refund to Processing ───

/**
 * Transition a refund from REQUESTED to PROCESSING.
 * Called when the provider refund request is initiated.
 */
export async function markRefundProcessing(refundId: string): Promise<void> {
  const result = await db.refund.updateMany({
    where: { id: refundId, status: 'REQUESTED' },
    data: { status: 'PROCESSING' },
  });

  if (result.count === 0) {
    logger.warn('Refund not in REQUESTED state for processing transition', { refundId });
  }
}
