/**
 * POST /api/payments/:id/verify
 *
 * Server-side payment verification.
 * - Auth required (booking owner or SUPER_ADMIN)
 * - Rate limited: 5 req/min
 * - Calls provider's verifyPayment (server-to-provider)
 * - On success, calls confirmBookingOnPaymentSuccess()
 * - On definitive failure (Phase 5G), transitions Payment → FAILED
 *   and releases reserved inventory atomically
 * - NEVER trusts client-submitted status
 *
 * CRITICAL: This is the ONLY path (along with webhooks) that can
 * transition Payment → COMPLETED. The browser callback URL is NOT
 * the trust boundary — it merely triggers this verification.
 *
 * Phase 5G Hardening: When Paystack reports a payment as definitively
 * failed (not just pending), we now atomically transition Payment → FAILED
 * and release the reserved inventory. Previously, the route only logged
 * this condition without taking action, leaving inventory reserved until
 * the webhook or expiry sweep handled it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { verifyPaymentSchema } from '@/lib/validations/payments';
import { confirmBookingOnPaymentSuccess, validatePaymentTransition } from '@/lib/services';
import { providerRegistry } from '@/lib/services/payment-provider';
import { releaseReservation } from '@/lib/services/inventory';
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
    // Phase 5G Hardening: Actually transition Payment → FAILED and release inventory.
    // Previously this only logged but left the payment in PENDING/PROCESSING with
    // inventory reserved, relying solely on webhook or expiry sweep.
    if (!verifyResult.isPending) {
      try {
        // Validate transition through state machine
        const transition = validatePaymentTransition(payment.status, 'FAILED');

        // Atomically: Payment → FAILED + release inventory
        await db.$transaction(async (tx) => {
          // 1. Transition Payment → FAILED
          await tx.payment.update({
            where: { id: paymentId },
            data: {
              status: 'FAILED',
              failedAt: transition.timestampFields.failedAt ?? new Date(),
            },
          });

          // 2. Release reserved inventory for each ticket type
          const booking = await tx.booking.findUnique({
            where: { id: payment.booking!.id },
            include: { tickets: { select: { ticketTypeId: true } } },
          });

          if (booking) {
            const ticketTypeCounts = new Map<string, number>();
            for (const ticket of booking.tickets) {
              const count = ticketTypeCounts.get(ticket.ticketTypeId) ?? 0;
              ticketTypeCounts.set(ticket.ticketTypeId, count + 1);
            }
            for (const [ticketTypeId, quantity] of ticketTypeCounts) {
              await releaseReservation({ ticketTypeId, quantity, tx });
            }
          }
        });

        logger.info('Payment definitively failed via verify — inventory released', {
          paymentId,
          providerReference,
        });
      } catch (failureError) {
        // If transition fails (e.g., payment already COMPLETED by concurrent webhook),
        // that's fine — the payment is in a terminal state.
        logger.warn('Failed to transition payment to FAILED on verify (may be concurrent update)', {
          paymentId,
          error: failureError instanceof Error ? failureError.message : 'Unknown',
        });
      }

      // Reload payment for accurate response
      const updatedPayment = await db.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, status: true, provider: true, providerRef: true, failedAt: true },
      });

      return NextResponse.json({
        payment: updatedPayment ?? {
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
