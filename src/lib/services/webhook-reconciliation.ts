/**
 * Phase 5E Stage 4: Webhook Reconciliation Service
 *
 * Finds and retries unprocessed webhook events that failed transiently.
 *
 * Background:
 *   The webhook architecture uses "acknowledge-after-receipt":
 *   - Validly signed webhooks return HTTP 200 always
 *   - Successful processing: PaymentWebhookEvent.processed = true
 *   - Transient failures: processed = false, processingError set
 *   - Permanent failures (amount mismatch, etc.): processed = true (non-retriable)
 *
 *   Without reconciliation, transiently failed events sit in the DB forever
 *   with no path to recovery. This service provides that path.
 *
 * Safety:
 *   - Configurable limit prevents runaway processing
 *   - Max age filter avoids retrying very old events (likely stale)
 *   - Uses existing processWebhookEvent() — all idempotency guarantees apply
 *   - This is a MANUAL operation triggered by admin, NOT a cron job
 *
 * Reconciliation query:
 *   PaymentWebhookEvent WHERE
 *     processed = false
 *     AND processingError IS NOT NULL
 *     AND createdAt > (now - maxAgeHours)
 *   ORDER BY createdAt ASC
 *   LIMIT N
 */

import { db } from '@/lib/db';
import { processWebhookEvent } from './payment-webhook';
import type { NormalizedWebhookEvent } from './payment-provider';
import { asMoney } from '@/lib/money';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface ReconcileOptions {
  /** Maximum number of events to retry per call (default: 50) */
  limit?: number;
  /** Only retry events newer than this many hours (default: 24) */
  maxAgeHours?: number;
}

export interface ReconcileResult {
  /** Total events found matching the query (before limit) */
  found: number;
  /** Events that were retried (attempted) */
  retried: number;
  /** Events that succeeded on retry (now processed=true) */
  succeeded: number;
  /** Events that still failed after retry (still processed=false) */
  stillFailed: number;
  /** Events skipped (e.g., payload unparseable) */
  skipped: number;
  /** Details of individual event retry outcomes */
  details: ReconcileEventDetail[];
}

export interface ReconcileEventDetail {
  /** PaymentWebhookEvent ID */
  webhookEventId: string;
  /** Provider's event ID */
  eventId: string;
  /** Outcome of the retry */
  outcome: 'succeeded' | 'still_failed' | 'skipped';
  /** Error message if failed/skipped */
  error?: string;
}

// ─── Core: Reconcile Unprocessed Events ───

/**
 * Find and retry unprocessed webhook events.
 *
 * This is the main entry point for webhook reconciliation.
 * It should be called by an admin endpoint (NOT a cron job).
 */
export async function reconcileUnprocessedEvents(
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const limit = options.limit ?? 50;
  const maxAgeHours = options.maxAgeHours ?? 24;

  const maxAgeCutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  // 1. Query unprocessed events
  const unprocessedEvents = await db.paymentWebhookEvent.findMany({
    where: {
      processed: false,
      processingError: { not: null },
      createdAt: { gt: maxAgeCutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      eventId: true,
      eventType: true,
      eventReference: true,
      provider: true,
      payload: true,
      signature: true,
      processingError: true,
      createdAt: true,
    },
  });

  // Also count total matching events (without limit) for observability
  const totalCount = await db.paymentWebhookEvent.count({
    where: {
      processed: false,
      processingError: { not: null },
      createdAt: { gt: maxAgeCutoff },
    },
  });

  logger.info('Webhook reconciliation starting', {
    found: totalCount,
    toProcess: unprocessedEvents.length,
    limit,
    maxAgeHours,
  });

  const result: ReconcileResult = {
    found: totalCount,
    retried: 0,
    succeeded: 0,
    stillFailed: 0,
    skipped: 0,
    details: [],
  };

  // 2. Process each event
  for (const event of unprocessedEvents) {
    // Parse the stored payload back to a NormalizedWebhookEvent
    const normalizedEvent = parsePayloadAsNormalizedEvent(event.payload);

    if (!normalizedEvent) {
      // Can't parse the payload — skip this event
      result.skipped++;
      result.details.push({
        webhookEventId: event.id,
        eventId: event.eventId,
        outcome: 'skipped',
        error: 'Payload could not be parsed as NormalizedWebhookEvent',
      });

      logger.warn('Webhook reconciliation: skipping unparseable event', {
        webhookEventId: event.id,
        eventId: event.eventId,
      });

      continue;
    }

    // Retry the event through processWebhookEvent
    result.retried++;

    try {
      const processResult = await processWebhookEvent({
        event: normalizedEvent,
        rawPayload: event.payload,
        signature: event.signature ?? undefined,
      });

      if (processResult.processed) {
        // Retry succeeded
        result.succeeded++;
        result.details.push({
          webhookEventId: event.id,
          eventId: event.eventId,
          outcome: 'succeeded',
        });
      } else {
        // processWebhookEvent returned processed=false (e.g., duplicate)
        // This shouldn't normally happen for unprocessed events, but handle it
        result.skipped++;
        result.details.push({
          webhookEventId: event.id,
          eventId: event.eventId,
          outcome: 'skipped',
          error: processResult.outcome,
        });
      }
    } catch (error) {
      // Retry failed — event remains unprocessed
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.stillFailed++;
      result.details.push({
        webhookEventId: event.id,
        eventId: event.eventId,
        outcome: 'still_failed',
        error: errorMessage,
      });

      logger.warn('Webhook reconciliation: retry failed', {
        webhookEventId: event.id,
        eventId: event.eventId,
        error: errorMessage,
      });
    }
  }

  logger.info('Webhook reconciliation completed', {
    found: result.found,
    retried: result.retried,
    succeeded: result.succeeded,
    stillFailed: result.stillFailed,
    skipped: result.skipped,
  });

  return result;
}

// ─── Helper: Parse Payload as NormalizedWebhookEvent ───

/**
 * Try to parse a stored payload string as a NormalizedWebhookEvent.
 *
 * The payload is stored as either:
 *   - rawPayload (the raw HTTP body from the provider — may NOT be a NormalizedWebhookEvent)
 *   - JSON.stringify(event) (when no rawPayload was provided — IS a NormalizedWebhookEvent)
 *
 * This function attempts to parse the JSON and validate it has the
 * expected shape of a NormalizedWebhookEvent. If it doesn't match,
 * returns null (the event will be skipped by reconciliation).
 *
 * JSON serialization notes:
 *   - `eventAt` (Date) becomes an ISO string → convert back to Date
 *   - `amount` (Money branded type) becomes a plain number → cast back via asMoney()
 */
function parsePayloadAsNormalizedEvent(payload: string): NormalizedWebhookEvent | null {
  try {
    const parsed = JSON.parse(payload);

    // Validate the shape of a NormalizedWebhookEvent
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.provider !== 'string' ||
      typeof parsed.eventId !== 'string' ||
      typeof parsed.eventType !== 'string' ||
      typeof parsed.eventReference !== 'string' ||
      typeof parsed.amount !== 'number' ||
      typeof parsed.currency !== 'string' ||
      typeof parsed.isPaymentSuccess !== 'boolean' ||
      typeof parsed.isPaymentFailure !== 'boolean'
    ) {
      return null;
    }

    // Convert serialized values back to their proper types
    const event: NormalizedWebhookEvent = {
      provider: parsed.provider,
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      eventReference: parsed.eventReference,
      amount: asMoney(parsed.amount),
      currency: parsed.currency,
      eventAt: parsed.eventAt ? new Date(parsed.eventAt) : new Date(),
      isPaymentSuccess: parsed.isPaymentSuccess,
      isPaymentFailure: parsed.isPaymentFailure,
    };

    return event;
  } catch {
    return null;
  }
}
