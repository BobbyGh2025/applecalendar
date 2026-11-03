/**
 * GET /api/payments/:id/refunds
 * POST /api/payments/:id/refund
 *
 * Get refunds for a payment, or request a refund.
 * - GET auth: booking owner or SUPER_ADMIN
 * - POST auth: booking owner, event organizer, or SUPER_ADMIN
 * - POST is rate limited: 3 req/min
 * - Refund request validates payment is COMPLETED
 * - Phase 6D (C2): ONLY the event organizer or SUPER_ADMIN can execute a
 *   provider refund. A booking owner's request is recorded as REQUESTED
 *   and held for organizer/admin approval — no Paystack call is made.
 *   Every refund action is written to the AuditLog.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { requestRefundSchema } from '@/lib/validations/payments';
import { requestRefund } from '@/lib/services';
import { providerRegistry } from '@/lib/services/payment-provider';
import { db } from '@/lib/db';
import { asMoney } from '@/lib/money';
import { logger } from '@/lib/logger';

const refundLimiter = rateLimit({ windowMs: 60_000, maxRequests: 3 });
const listLimiter = rateLimit({ windowMs: 60_000, maxRequests: 20 });

/**
 * GET /api/payments/:id/refund — List refunds for a payment
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rl = listLimiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const user = await authenticate(request);
    const { id: paymentId } = await params;

    // Load payment for ownership check
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        booking: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!payment) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }

    // Ownership check
    if (payment.booking?.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view refunds for this payment');
    }

    const refunds = await db.refund.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        reason: true,
        status: true,
        providerRef: true,
        requestedBy: true,
        processedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ refunds });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/payments/:id/refund — Request a refund
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rl = refundLimiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const user = await authenticate(request);
    const { id: paymentId } = await params;

    const body = await request.json();
    const parsed = requestRefundSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { amount, reason } = parsed.data;

    // Load payment for ownership check (+ event organizer for refund approval)
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        amount: true,
        currency: true,
        provider: true,
        status: true,
        providerRef: true,
        booking: {
          select: {
            userId: true,
            event: {
              select: {
                organizerId: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }

    // Authorization (Phase 6D C2):
    //  - The booking owner may REQUEST a refund (recorded, no provider call).
    //  - Only the event organizer or SUPER_ADMIN may EXECUTE the refund
    //    against the provider. This closes the self-refund abuse path where
    //    any attendee could move real money at any time.
    const isBookingOwner = payment.booking?.userId === user.id;
    const isEventOrganizer = payment.booking?.event.organizerId === user.id;
    const isSuperAdmin = user.role === 'SUPER_ADMIN';

    if (!isBookingOwner && !isEventOrganizer && !isSuperAdmin) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to request a refund for this payment');
    }
    const canExecuteProviderRefund = isEventOrganizer || isSuperAdmin;

    // Request refund via domain service
    const refundResult = await requestRefund({
      paymentId,
      amount,
      reason,
      requestedBy: user.id,
    });

    // For PAYSTACK provider, initiate refund with Paystack — but ONLY when the
    // requester is authorized to execute refunds (organizer/admin). A booking
    // owner's request stays in REQUESTED state pending approval.
    if (payment.provider === 'PAYSTACK' && canExecuteProviderRefund) {
      const paystackProvider = providerRegistry.require('PAYSTACK');
      const providerRefundResult = await paystackProvider.requestRefund({
        paymentId,
        providerReference: payment.providerRef ?? '',
        amount: asMoney(amount),
        currency: payment.currency,
        reason,
      });

      if (providerRefundResult.success) {
        // Update refund with provider reference and mark as PROCESSING
        await db.refund.update({
          where: { id: refundResult.refundId },
          data: {
            providerRef: providerRefundResult.refundReference,
            status: 'PROCESSING',
          },
        });
      } else {
        // Provider refund failed — log and leave refund in REQUESTED state
        // The refund can be retried or processed manually
        logger.warn('Paystack refund initiation failed', {
          refundId: refundResult.refundId,
          paymentId,
          errorCode: providerRefundResult.errorCode,
          errorMessage: providerRefundResult.errorMessage,
          retryable: providerRefundResult.retryable,
        });
      }
    }

    // AuditLog — every refund action is recorded (Phase 6D C2)
    try {
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: canExecuteProviderRefund ? 'APPROVE' : 'CREATE',
          entityType: 'Refund',
          entityId: refundResult.refundId,
          newValue: JSON.stringify({
            paymentId,
            amount,
            status: canExecuteProviderRefund && payment.provider === 'PAYSTACK'
              ? 'PROCESSING (provider initiated)'
              : 'REQUESTED (awaiting organizer/admin approval)',
            executedProviderRefund: canExecuteProviderRefund,
          }),
          reason: reason ?? null,
        },
      });
    } catch (auditError) {
      logger.error('Failed to write refund AuditLog', {
        refundId: refundResult.refundId,
        error: auditError instanceof Error ? auditError.message : 'unknown',
      });
    }

    // Fetch the refund for response
    const refund = await db.refund.findUnique({
      where: { id: refundResult.refundId },
      select: {
        id: true,
        amount: true,
        reason: true,
        status: true,
        providerRef: true,
        paymentId: true,
        createdAt: true,
      },
    });

    logger.info('Refund requested', {
      refundId: refundResult.refundId,
      paymentId,
      amount,
      requestedBy: user.id,
      executedProviderRefund: canExecuteProviderRefund,
    });

    return NextResponse.json(
      {
        refund,
        ...(canExecuteProviderRefund
          ? {}
          : {
              message:
                'Refund request recorded. It will be processed by the event organizer or an administrator.',
              pendingApproval: true,
            }),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
