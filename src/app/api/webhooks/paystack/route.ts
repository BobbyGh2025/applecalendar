/**
 * POST /api/webhooks/paystack
 *
 * Paystack webhook reception.
 * - NO auth (webhook from provider)
 * - Verifies HMAC-SHA512 signature using PAYSTACK_WEBHOOK_SECRET
 * - Rate limited: 100 req/min (high volume expected)
 *
 * ARCHITECTURE: Acknowledge-After-Receipt Pattern
 *
 * After signature verification, this route ALWAYS returns HTTP 200.
 * This is an intentional design decision, not a bug:
 *
 * 1. The webhook event is recorded in PaymentWebhookEvent with processed=false
 * 2. The domain service processWebhookEvent() processes it
 * 3. On success: event marked processed=true
 * 4. On transient failure: event stays processed=false with processingError
 * 5. On permanent failure: event marked processed=true (non-retriable)
 *
 * Rationale for always-200:
 *   - Paystack retries on non-200, but only for a limited time
 *   - Retries of already-processed events waste resources and risk double effects
 *   - Transient DB failures are better handled by our own reconciliation
 *   - The processed=false filter enables a cron/reconciliation job to find
 *     and retry failed events without depending on provider retry timing
 *
 * Recovery for transient failures:
 *   - Query PaymentWebhookEvent WHERE processed=false AND processingError IS NOT NULL
 *   - Re-inject these events through processWebhookEvent()
 *   - Or use the payment verify endpoint for each affected payment
 *
 * Signature verification errors (missing/invalid) return 401 immediately
 * (before any processing) — these are not valid webhook deliveries.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/errors';
import { processWebhookEvent } from '@/lib/services';
import type { NormalizedWebhookEvent } from '@/lib/services/payment-provider';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import crypto from 'crypto';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 100 });

/**
 * Verify Paystack webhook signature.
 * Paystack uses HMAC-SHA512 of the raw request body.
 */
function verifyPaystackSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expected = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const rl = limiter(request);
    if (!rl.success) throw new RateLimitError(rl.remaining, rl.resetAt);

    // Read raw body as text (needed for signature verification)
    const rawBody = await request.text();

    // Get signature from header
    const signature = request.headers.get('x-paystack-signature');
    if (!signature) {
      logger.warn('Paystack webhook: missing signature header');
      return NextResponse.json(
        { success: false, error: { code: 'MISSING_SIGNATURE', message: 'Missing webhook signature' } },
        { status: 401 }
      );
    }

    // Verify signature
    const secret = env.PAYSTACK_WEBHOOK_SECRET;
    const isValid = verifyPaystackSignature(rawBody, signature, secret);
    if (!isValid) {
      logger.warn('Paystack webhook: invalid signature');
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } },
        { status: 401 }
      );
    }

    // Parse the webhook payload
    let payload: { event: string; data: Record<string, unknown> };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logger.warn('Paystack webhook: invalid JSON payload');
      // Permanently malformed — acknowledge to prevent retries
      return NextResponse.json({ received: true });
    }

    const { event, data } = payload;

    // Normalize the webhook event
    // eventId uses the provider's data.id (unique per event).
    // If data.id is missing (malformed payload), generate a unique fallback
    // using crypto.randomUUID() instead of Date.now() to avoid same-ms collisions.
    const providerEventId = data.id;
    if (!providerEventId) {
      logger.warn('Paystack webhook: missing data.id in payload', { event });
    }

    const normalized: NormalizedWebhookEvent = {
      provider: 'PAYSTACK',
      eventId: `paystack-${providerEventId ?? crypto.randomUUID()}`,
      eventType: event,
      eventReference: (data.reference as string) ?? '',
      amount: (data.amount as number) as unknown as NormalizedWebhookEvent['amount'],
      currency: (data.currency as string) ?? 'GHS',
      eventAt: new Date(),
      isPaymentSuccess: event === 'charge.success',
      isPaymentFailure: event === 'charge.failed',
    };

    // Process the event via domain service
    try {
      await processWebhookEvent({
        event: normalized,
        rawPayload: rawBody,
        signature,
      });

      logger.info('Paystack webhook processed', {
        eventType: event,
        eventId: normalized.eventId,
      });
    } catch (processingError) {
      // Log the error but still return 200 (acknowledge-after-receipt pattern).
      // The PaymentWebhookEvent record has processed=false and processingError set,
      // enabling a reconciliation job to find and retry failed events.
      // See architecture documentation at top of this file.
      const isDomainError = processingError instanceof Error && 'code' in processingError;
      logger.error('Paystack webhook processing error', {
        eventType: event,
        eventId: normalized.eventId,
        error: processingError instanceof Error ? processingError.message : 'Unknown error',
        isDomainError,
        // Domain errors (amount mismatch, invalid transition) are permanent —
        // retrying won't help. Transient errors (DB timeout, lock contention)
        // should be retried by the reconciliation job.
      });
    }

    // Always acknowledge receipt (acknowledge-after-receipt pattern)
    return NextResponse.json({ received: true });
  } catch (error) {
    // Rate limit errors should still be surfaced
    if (error instanceof RateLimitError) {
      return handleApiError(error);
    }

    // For any other error, still acknowledge receipt to prevent retries
    logger.error('Paystack webhook unexpected error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ received: true });
  }
}
