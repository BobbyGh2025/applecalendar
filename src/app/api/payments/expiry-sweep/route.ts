/**
 * POST /api/payments/expiry-sweep
 *
 * Expire eligible payments (internal/admin).
 * - Auth required + SUPER_ADMIN only
 * - Rate limited: 2 req/min
 * - Calls expireEligiblePayments() and returns results
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { expireEligiblePayments } from '@/lib/services';
import { logger } from '@/lib/logger';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 2 });

export async function POST(request: NextRequest) {
  try {
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);

    const result = await expireEligiblePayments();

    logger.info('Payment expiry sweep completed', {
      expired: result.expired,
      errors: result.errors.length,
      triggeredBy: user.id,
    });

    return NextResponse.json({
      expired: result.expired,
      bookingsExpired: result.bookingsExpired,
      errors: result.errors.length,
      expiredPaymentIds: result.expiredPaymentIds,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
