/**
 * GET /api/payments/:id
 *
 * Get payment status.
 * - Auth required (booking owner or SUPER_ADMIN)
 * - Loads payment with related booking summary
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { db } from '@/lib/db';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 20 });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const user = await authenticate(request);
    const { id: paymentId } = await params;

    // Load payment with booking for ownership check
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        amount: true,
        currency: true,
        provider: true,
        status: true,
        providerRef: true,
        refundedAmount: true,
        idempotencyKey: true,
        expiresAt: true,
        completedAt: true,
        failedAt: true,
        cancelledAt: true,
        failureReason: true,
        createdAt: true,
        updatedAt: true,
        booking: {
          select: {
            id: true,
            bookingRef: true,
            status: true,
            userId: true,
            event: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }

    // Ownership check: only the booking owner or SUPER_ADMIN may view
    if (payment.booking?.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view this payment');
    }

    return NextResponse.json({ payment });
  } catch (error) {
    return handleApiError(error);
  }
}
