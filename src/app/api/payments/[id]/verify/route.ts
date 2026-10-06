/**
 * POST /api/payments/:id/verify
 *
 * Server-side payment verification.
 * - Auth required (booking owner)
 * - Rate limited: 5 req/min
 * - Calls provider's verifyPayment
 * - On success, calls confirmBookingOnPaymentSuccess()
 * - Returns 501 if provider integration is pending
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { verifyPaymentSchema } from '@/lib/validations/payments';
import {
  confirmBookingOnPaymentSuccess,
  ProviderIntegrationPending,
} from '@/lib/services';
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

    // Ownership check
    if (payment.booking?.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to verify this payment');
    }

    // Already completed?
    if (payment.status === 'COMPLETED') {
      return NextResponse.json({
        payment: {
          id: payment.id,
          status: payment.status,
          provider: payment.provider,
        },
        verified: true,
        message: 'Payment is already completed',
      });
    }

    // Attempt provider verification
    try {
      const provider = providerRegistry.require(payment.provider as 'PAYSTACK' | 'MANUAL' | 'FREE');
      const verifyResult = await provider.verifyPayment({
        paymentId: payment.id,
        providerReference,
        expectedAmount: asMoney(payment.amount),
        expectedCurrency: payment.currency,
      });

      if (verifyResult.success) {
        // Payment verified — confirm booking
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
      });

      return NextResponse.json({
        payment: {
          id: payment.id,
          status: payment.status,
          provider: payment.provider,
        },
        verified: false,
        error: {
          code: verifyResult.errorCode,
          message: verifyResult.errorMessage,
        },
      });
    } catch (error) {
      if (error instanceof ProviderIntegrationPending) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'PROVIDER_INTEGRATION_PENDING',
              message: error.message,
              details: error.details,
            },
          },
          { status: 501 }
        );
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
