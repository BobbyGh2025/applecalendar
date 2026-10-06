/**
 * GET /api/payments/callback
 *
 * Browser callback after Paystack payment redirect.
 *
 * CRITICAL SECURITY BOUNDARY:
 *   This route is a USER-EXPERIENCE mechanism, NOT the payment trust boundary.
 *   It does NOT set Payment, Booking, Inventory, or Ticket state directly.
 *
 * Flow:
 *   1. Paystack redirects browser here with ?reference=xxx
 *   2. This route returns payment status information
 *   3. The frontend should call POST /api/payments/:id/verify
 *      for server-side verification before considering payment complete
 *
 * The server-side verification endpoint is the ONLY path that can
 * transition Payment → COMPLETED (along with webhooks).
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 20 });

const callbackQuerySchema = z.object({
  reference: z.string().min(1, 'Reference is required'),
  trxref: z.string().optional(), // Paystack also sends trxref
});

export async function GET(request: NextRequest) {
  try {
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const url = new URL(request.url);
    const parsed = callbackQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const reference = parsed.data.reference;

    // Look up the payment by provider reference (idempotencyKey used as reference)
    const payment = await db.payment.findFirst({
      where: {
        OR: [
          { providerRef: reference },
          { idempotencyKey: reference },
        ],
      },
      select: {
        id: true,
        status: true,
        provider: true,
        amount: true,
        currency: true,
        providerRef: true,
        booking: {
          select: {
            id: true,
            status: true,
            bookingRef: true,
          },
        },
      },
    });

    if (!payment) {
      // Payment not found — but we don't expose whether the reference exists
      // Return a generic response that tells the frontend to verify
      logger.info('Payment callback: reference not found', { reference });
      return NextResponse.json({
        status: 'UNKNOWN',
        reference,
        message: 'Payment reference not found. Please verify your payment.',
        verifyEndpoint: `/api/payments/verify`,
      });
    }

    logger.info('Payment callback received', {
      paymentId: payment.id,
      reference,
      paymentStatus: payment.status,
      bookingStatus: payment.booking?.status,
    });

    // Return payment status — the frontend MUST call verify for authoritative status
    return NextResponse.json({
      status: payment.status,
      reference,
      paymentId: payment.id,
      bookingId: payment.booking?.id,
      bookingRef: payment.booking?.bookingRef,
      provider: payment.provider,
      // If already completed, the frontend can display success
      // If pending/processing, the frontend MUST call verify
      needsVerification: payment.status === 'PENDING' || payment.status === 'PROCESSING',
      verifyEndpoint: `/api/payments/${payment.id}/verify`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
