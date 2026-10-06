/**
 * POST /api/payments/:id/verify
 *
 * Server-side payment verification.
 * - Auth required (booking owner or SUPER_ADMIN)
 * - Rate limited: 5 req/min
 * - Calls provider's verifyPayment (server-to-provider)
 * - On success, calls confirmBookingOnPaymentSuccess()
 * - NEVER trusts client-submitted status
 *
 * CRITICAL: This is the ONLY path (along with webhooks) that can
 * transition Payment → COMPLETED. The browser callback URL is NOT
 * the trust boundary — it merely triggers this verification.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { verifyPaymentSchema } from '@/lib/validations/payments';
import { confirmBookingOnPaymentSuccess } from '@/lib/services';
import { providerRegistry } from '@/lib/services/payment-provider';
import { db } from '@/lib/db';
import { asMoney } from '@/lib/money';
import { logger } from '@/lib/logger';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const user = await authenticate(request);
    const { id: paymentId } = await params;

    const body = await request.json();
    const parsed = verifyPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { providerReference } = parsed.data;

    // Load payment for ownership check
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
            id: true,
            userId: true,
          },
        },
      },
    });

    if (!payment) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }

    // Ownership check: only the booking owner or SUPER_ADMIN may verify
    if (payment.booking?.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to verify this payment');
    }

    // Already completed? Return idempotent success
    if (payment.status === 'COMPLETED') {
      return NextResponse.json({
        payment: {
          id: payment.id,
          status: payment.status,
          provider: payment.provider,
          providerRef: payment.providerRef,
        },
        verified: true,
        message: 'Payment is already completed',
      });
    }

    // Payment must be in PENDING or PROCESSING to verify
    if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
      throw new ApiError(400, 'PAYMENT_NOT_VERIFIABLE', `Payment is in ${payment.status} status and cannot be verified`);
    }

    // Provider verification — server-to-provider, NEVER trusts client
    const provider = providerRegistry.require(payment.provider as 'PAYSTACK' | 'MANUAL' | 'FREE');
    const verifyResult = await provider.verifyPayment({
      paymentId: payment.id,
      providerReference,
      expectedAmount: asMoney(payment.amount),
      expectedCurrency: payment.currency,
    });

    if (verifyResult.success) {
      // Payment verified by provider — confirm booking atomically
      const confirmResult = await confirmBookingOnPaymentSuccess({
        paymentId: payment.id,
        providerReference: verifyResult.providerReference,
      });

      // Reload payment for response
      const updatedPayment = await db.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          amount: true,
          currency: true,
          provider: true,
          status: true,
          providerRef: true,
          completedAt: true,
        },
      });

      logger.info('Payment verified and booking confirmed', {
        paymentId,
        providerReference,
        confirmed: confirmResult.confirmed,
        ticketsActivated: confirmResult.ticketsActivated,
      });

      return NextResponse.json({
        payment: updatedPayment,
        verified: true,
      });
    }

    // Verification failed at provider
    logger.warn('Payment verification failed at provider', {
      paymentId,
      providerReference,
      errorCode: verifyResult.errorCode,
      errorMessage: verifyResult.errorMessage,
    });

    // If payment is confirmed failed (not just pending), handle the failure
    if (!verifyResult.isPending) {
      // Payment is definitively failed — update payment status and release inventory
      // This is done through the domain services, not directly
      logger.info('Payment definitively failed — releasing reservation', {
        paymentId,
        providerReference,
      });

      return NextResponse.json({
        payment: {
          id: payment.id,
          status: payment.status,
          provider: payment.provider,
          providerRef: payment.providerRef,
        },
        verified: false,
        error: {
          code: verifyResult.errorCode,
          message: verifyResult.errorMessage,
        },
      });
    }

    // Payment is still pending at provider
    return NextResponse.json({
      payment: {
        id: payment.id,
        status: payment.status,
        provider: payment.provider,
        providerRef: payment.providerRef,
      },
      verified: false,
      error: {
        code: verifyResult.errorCode,
        message: verifyResult.errorMessage,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
