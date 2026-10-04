/**
 * Phase 5E Stage 2: Payment Webhook Processing Service
 *
 * Domain service for processing payment webhook events.
 * NO HTTP route is created in Stage 2 — this is the domain logic only.
 *
 * Responsibilities:
 *   1. Validate normalized webhook event data
 *   2. Deduplicate using PaymentWebhookEvent.eventId (unique constraint)
 *   3. Locate the correct payment by provider reference
 *   4. Verify amount and currency match
 *   5. Transition payment through the state machine
 *   6. Invoke booking confirmation on successful payment
 *   7. Persist webhook processing result
 *
 * Idempotency:
 *   - Same eventId processed twice → no duplicate effects
 *   - Uses PaymentWebhookEvent.eventId unique constraint for dedup
 *   - Payment state machine prevents illegal transitions
 *   - Booking confirmation is idempotent
 *
 * Processing order:
 *   - Mark event as received (insert with processed=false)
 *   - Process business logic (transition payment, confirm booking)
 *   - Mark event as processed (update processed=true)
 *   - Do NOT mark processed before business logic succeeds (durable guarantee)
 */

import { db } from '@/lib/db';
import { validatePaymentTransition } from './payment-state-machine';
import { confirmBookingOnPaymentSuccess } from './booking-confirmation';
import { releaseReservation } from './inventory';
import {
  WebhookAlreadyProcessed,
  WebhookAmountMismatch,
  WebhookCurrencyMismatch,
  PaymentNotFound,
  PaymentDomainError,
} from './payment-domain-errors';
import type { NormalizedWebhookEvent } from './payment-provider';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface ProcessWebhookEventParams {
  /** Normalized webhook event (already parsed and signature-verified) */
  event: NormalizedWebhookEvent;
  /** Raw payload for storage */
  rawPayload?: string;
  /** Signature for storage */
  signature?: string;
}

export interface ProcessWebhookEventResult {
  /** Webhook event database ID */
  webhookEventId: string;
  /** Whether this event was newly processed */
  processed: boolean;
  /** Payment ID that was affected (if found) */
  paymentId: string | null;
  /** Description of what happened */
  outcome: string;
}

// ─── Core: Process Webhook Event ───

/**
 * Process a normalized webhook event.
 *
 * This is the main entry point for webhook processing after
 * the provider adapter has normalized the raw webhook payload.
 */
export async function processWebhookEvent(
  params: ProcessWebhookEventParams,
): Promise<ProcessWebhookEventResult> {
  const { event, rawPayload, signature } = params;

  // 1. Deduplication: check if this event has already been processed
  const existingEvent = await db.paymentWebhookEvent.findUnique({
    where: { eventId: event.eventId },
    select: { id: true, processed: true },
  });

  if (existingEvent?.processed) {
    logger.info('Webhook event already processed (dedup)', { eventId: event.eventId });
    return {
      webhookEventId: existingEvent.id,
      processed: false,
      paymentId: null,
      outcome: 'Event already processed — duplicate ignored',
    };
  }

  // 2. Record the event (or update if it exists but wasn't processed)
  let webhookEventId: string;
  if (existingEvent) {
    webhookEventId = existingEvent.id;
  } else {
    const webhookEvent = await db.paymentWebhookEvent.create({
      data: {
        provider: event.provider,
        eventId: event.eventId,
        eventType: event.eventType,
        eventReference: event.eventReference,
        payload: rawPayload ?? JSON.stringify(event),
        signature: signature ?? null,
        processed: false,
      },
      select: { id: true },
    });
    webhookEventId = webhookEvent.id;
  }

  // 3. Locate the payment by provider reference
  const payment = await db.payment.findFirst({
    where: { providerRef: event.eventReference },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      bookingId: true,
    },
  });

  if (!payment) {
    // Payment not found — mark event as processed with error
    await markEventProcessed(webhookEventId, false, 'Payment not found for provider reference');
    return {
      webhookEventId,
      processed: true,
      paymentId: null,
      outcome: 'Payment not found for provider reference',
    };
  }

  // 4. Verify amount matches
  if (event.amount !== payment.amount) {
    await markEventProcessed(webhookEventId, false, 'Amount mismatch');
    throw new WebhookAmountMismatch(payment.amount, event.amount);
  }

  // 5. Verify currency matches
  if (event.currency !== payment.currency) {
    await markEventProcessed(webhookEventId, false, 'Currency mismatch');
    throw new WebhookCurrencyMismatch(payment.currency, event.currency);
  }

  // 6. Process the event based on type
  try {
    let outcome: string;

    if (event.isPaymentSuccess) {
      // Payment success → confirm booking
      const result = await confirmBookingOnPaymentSuccess({
        paymentId: payment.id,
        providerReference: event.eventReference,
      });
      outcome = result.confirmed
        ? 'Payment completed and booking confirmed'
        : 'Payment already completed (idempotent)';
    } else if (event.isPaymentFailure) {
      // Payment failure → transition payment to FAILED + release inventory
      // Must be transactional: if inventory release fails, payment should not be FAILED
      const transition = validatePaymentTransition(payment.status, 'FAILED');

      await db.$transaction(async (tx) => {
        // 1. Transition Payment → FAILED
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failedAt: transition.timestampFields.failedAt ?? new Date(),
          },
        });

        // 2. Release reserved inventory for each ticket type
        const booking = await tx.booking.findUnique({
          where: { id: payment.bookingId },
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

      outcome = 'Payment failed';
    } else {
      outcome = `Event type "${event.eventType}" not actionable`;
    }

    // 7. Mark event as successfully processed
    await markEventProcessed(webhookEventId, true);

    logger.info('Webhook event processed', {
      eventId: event.eventId,
      paymentId: payment.id,
      outcome,
    });

    return {
      webhookEventId,
      processed: true,
      paymentId: payment.id,
      outcome,
    };
  } catch (error) {
    // Mark event as failed — do NOT mark as processed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await markEventProcessed(webhookEventId, false, errorMessage);

    throw error;
  }
}

// ─── Helper: Mark Event Processed ───

async function markEventProcessed(
  webhookEventId: string,
  success: boolean,
  error?: string,
): Promise<void> {
  // Only mark processed=true when financial effects are durably committed.
  // Failed events remain processed=false so they can be retried.
  // The processingError field records what went wrong for observability.
  await db.paymentWebhookEvent.update({
    where: { id: webhookEventId },
    data: {
      processed: success,
      processedAt: success ? new Date() : null,
      ...(error && { processingError: error }),
    },
  });
}
