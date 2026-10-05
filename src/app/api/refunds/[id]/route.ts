/**
 * GET /api/refunds/:id
 *
 * Get refund status.
 * - Auth required (payment/booking owner or SUPER_ADMIN)
 * - Loads refund with payment, verifies ownership via payment.booking
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
    const { id: refundId } = await params;

    // Load refund with payment and booking for ownership check
    const refund = await db.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        amount: true,
        reason: true,
        status: true,
        providerRef: true,
        failureReason: true,
        requestedBy: true,
        processedAt: true,
        createdAt: true,
        updatedAt: true,
        payment: {
          select: {
            id: true,
            amount: true,
            currency: true,
            provider: true,
            status: true,
            refundedAmount: true,
            booking: {
              select: {
                id: true,
                userId: true,
                bookingRef: true,
              },
            },
          },
        },
      },
    });

    if (!refund) {
      throw new ApiError(404, 'REFUND_NOT_FOUND', 'Refund not found');
    }

    // Ownership check: only the booking owner or SUPER_ADMIN may view
    if (refund.payment.booking?.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view this refund');
    }

    return NextResponse.json({ refund });
  } catch (error) {
    return handleApiError(error);
  }
}
