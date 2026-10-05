/**
 * GET /api/payments/:id/attempts
 *
 * Get payment attempts for a payment.
 * - Auth required (booking owner or SUPER_ADMIN)
 * - Returns all attempts ordered by creation time (newest first)
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { getPaymentAttempts } from '@/lib/services';
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
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view this payment\'s attempts');
    }

    const attempts = await getPaymentAttempts(paymentId);

    return NextResponse.json({ attempts });
  } catch (error) {
    return handleApiError(error);
  }
}
