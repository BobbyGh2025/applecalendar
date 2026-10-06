/**
 * POST /api/payments/webhook-reconcile
 *
 * Manually trigger webhook reconciliation for unprocessed events.
 *
 * - Auth required + SUPER_ADMIN only (maintenance operation)
 * - Rate limited: 2 req/min (this is a heavy operation)
 * - Calls reconcileUnprocessedEvents() and returns counts
 *
 * Accepts optional JSON body:
 *   { limit?: number, maxAgeHours?: number }
 *
 * Returns:
 *   { found, retried, succeeded, stillFailed, skipped }
 *
 * This endpoint does NOT create a cron/scheduled job.
 * It is intended for manual admin use when transient webhook
 * failures are detected (e.g., via monitoring dashboards).
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { reconcileUnprocessedEvents } from '@/lib/services/webhook-reconciliation';
import { logger } from '@/lib/logger';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 2 });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    // Auth + role check
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);

    // Parse optional body parameters
    let limit: number | undefined;
    let maxAgeHours: number | undefined;

    try {
      const body = await request.json();
      if (body && typeof body === 'object') {
        if (typeof body.limit === 'number' && body.limit > 0 && body.limit <= 500) {
          limit = body.limit;
        }
        if (typeof body.maxAgeHours === 'number' && body.maxAgeHours > 0 && body.maxAgeHours <= 168) {
          maxAgeHours = body.maxAgeHours;
        }
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    // Run reconciliation
    const result = await reconcileUnprocessedEvents({ limit, maxAgeHours });

    logger.info('Webhook reconciliation completed', {
      found: result.found,
      retried: result.retried,
      succeeded: result.succeeded,
      stillFailed: result.stillFailed,
      skipped: result.skipped,
      triggeredBy: user.id,
    });

    return NextResponse.json({
      found: result.found,
      retried: result.retried,
      succeeded: result.succeeded,
      stillFailed: result.stillFailed,
      skipped: result.skipped,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
