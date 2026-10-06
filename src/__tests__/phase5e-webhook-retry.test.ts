/**
 * Phase 5E Stage 4: Webhook Retry/Reconciliation Tests
 *
 * Comprehensive tests for the webhook reconciliation mechanism.
 * Uses the REAL database (not mocked) — consistent with project test patterns.
 *
 * Test categories:
 *   1. Transient event failure is persisted (processed=false, processingError set)
 *   2. Event remains retryable (can be found by reconciliation query)
 *   3. Retry discovers the event
 *   4. Retry processes the event successfully
 *   5. Successful retry marks it processed=true
 *   6. Duplicate retry cannot double-confirm payment (idempotency)
 *   7. Permanent errors remain non-retriable (processed=true)
 *   8. Already-processed events are skipped by reconciliation
 *   9. Max age filter works (old events skipped)
 *  10. Limit parameter works (only process N events per call)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

// ─── Service imports ───
import { processWebhookEvent } from '@/lib/services/payment-webhook';
import { reconcileUnprocessedEvents } from '@/lib/services/webhook-reconciliation';
import { asMoney } from '@/lib/money';
import {
  WebhookAmountMismatch,
} from '@/lib/services/payment-domain-errors';
import type { NormalizedWebhookEvent } from '@/lib/services/payment-provider';

const prisma = new PrismaClient();

// ─── Test data tracking ───
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];
const createdEventIds: string[] = [];
const createdTicketTypeIds: string[] = [];
const createdBookingIds: string[] = [];
const createdPaymentIds: string[] = [];
const createdWebhookEventIds: string[] = [];

// ─── Helpers ───

async function createTestUser(suffix: string) {
  const bcrypt = await import('bcryptjs');
  const user = await prisma.user.create({
    data: {
      email: `recon-user-${suffix}-${Date.now()}@test.com`,
      password: await bcrypt.hash('test', 12),
      name: `Recon User ${suffix}`,
      role: 'PUBLIC',
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createTestOrg(suffix: string) {
  const bcrypt = await import('bcryptjs');
  const org = await prisma.user.create({
    data: {
      email: `recon-org-${suffix}-${Date.now()}@test.com`,
      password: await bcrypt.hash('test', 12),
      name: `Recon Org ${suffix}`,
      role: 'ORGANIZER',
    },
  });
  createdOrgIds.push(org.id);
  return org;
}

async function createTestEvent(orgId: string, suffix: string) {
  const event = await prisma.event.create({
    data: {
      title: `Recon Event ${suffix}`,
      slug: `recon-event-${suffix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      description: 'Test event for webhook reconciliation',
      startDate: new Date('2025-12-01'),
      organizerId: orgId,
      status: 'PUBLISHED',
      isPaid: true,
    },
  });
  createdEventIds.push(event.id);
  return event;
}

function makeNormalizedEvent(overrides: Partial<NormalizedWebhookEvent> & { eventReference: string }): NormalizedWebhookEvent {
  const { eventReference, ...rest } = overrides;
  return {
    provider: 'PAYSTACK',
    eventId: `recon-evt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    eventType: 'charge.success',
    eventReference,
    amount: asMoney(10000),
    currency: 'GHS',
    eventAt: new Date(),
    isPaymentSuccess: true,
    isPaymentFailure: false,
    ...rest,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. TRANSIENT EVENT FAILURE IS PERSISTED
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Transient failure persistence', () => {
  it('transient failure sets processed=false and processingError', async () => {
    // Create test data
    const user = await createTestUser('trans1');
    const org = await createTestOrg('trans1');
    const event = await createTestEvent(org.id, 'trans1');

    // Create booking in CANCELLED state — this will cause confirmBookingOnPaymentSuccess to fail
    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 10000,
        currency: 'GHS',
        status: 'CANCELLED',
        bookingRef: `RECON-TRANS1-${Date.now()}`,
        cancellationReason: 'Test transient failure',
      },
    });
    createdBookingIds.push(booking.id);

    // Create payment in PROCESSING state
    const providerRef = `recon-trans1-ref-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: user.id,
        amount: 10000,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'PROCESSING',
        idempotencyKey: `recon-trans1-${Date.now()}`,
        providerRef,
        processedAt: new Date(),
      },
    });
    createdPaymentIds.push(payment.id);

    // Create a normalized webhook event for this payment
    const normalizedEvent = makeNormalizedEvent({ eventReference: providerRef });

    // Call processWebhookEvent — should fail because booking is CANCELLED
    await expect(processWebhookEvent({ event: normalizedEvent })).rejects.toThrow();

    // Verify the webhook event was recorded with processed=false and processingError
    const webhookEvent = await prisma.paymentWebhookEvent.findUnique({
      where: { eventId: normalizedEvent.eventId },
    });

    expect(webhookEvent).not.toBeNull();
    expect(webhookEvent!.processed).toBe(false);
    expect(webhookEvent!.processingError).not.toBeNull();
    expect(webhookEvent!.processingError).not.toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. EVENT REMAINS RETRYABLE
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Event retryability', () => {
  it('failed event can be found by reconciliation query', async () => {
    // Create test data
    const user = await createTestUser('retry1');
    const org = await createTestOrg('retry1');
    const event = await createTestEvent(org.id, 'retry1');

    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 10000,
        currency: 'GHS',
        status: 'CANCELLED',
        bookingRef: `RECON-RETRY1-${Date.now()}`,
        cancellationReason: 'Test retryability',
      },
    });
    createdBookingIds.push(booking.id);

    const providerRef = `recon-retry1-ref-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: user.id,
        amount: 10000,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'PROCESSING',
        idempotencyKey: `recon-retry1-${Date.now()}`,
        providerRef,
        processedAt: new Date(),
      },
    });
    createdPaymentIds.push(payment.id);

    const normalizedEvent = makeNormalizedEvent({ eventReference: providerRef });

    // Process the event — will fail
    await expect(processWebhookEvent({ event: normalizedEvent })).rejects.toThrow();

    // Query using the same logic as reconciliation
    const retryableEvents = await prisma.paymentWebhookEvent.findMany({
      where: {
        processed: false,
        processingError: { not: null },
      },
    });

    const found = retryableEvents.find(e => e.eventId === normalizedEvent.eventId);
    expect(found).not.toBeUndefined();
    expect(found!.processed).toBe(false);
    expect(found!.processingError).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. RETRY DISCOVERS THE EVENT
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Retry discovers events', () => {
  it('reconciliation finds and attempts unprocessed events', async () => {
    // Create test data
    const user = await createTestUser('disc1');
    const org = await createTestOrg('disc1');
    const event = await createTestEvent(org.id, 'disc1');

    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 10000,
        currency: 'GHS',
        status: 'CANCELLED',
        bookingRef: `RECON-DISC1-${Date.now()}`,
        cancellationReason: 'Test discovery',
      },
    });
    createdBookingIds.push(booking.id);

    const providerRef = `recon-disc1-ref-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: user.id,
        amount: 10000,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'PROCESSING',
        idempotencyKey: `recon-disc1-${Date.now()}`,
        providerRef,
        processedAt: new Date(),
      },
    });
    createdPaymentIds.push(payment.id);

    const normalizedEvent = makeNormalizedEvent({ eventReference: providerRef });

    // Process the event — will fail
    await expect(processWebhookEvent({ event: normalizedEvent })).rejects.toThrow();

    // Run reconciliation
    const result = await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 24 });

    // The event should be discovered and retried
    // (It will still fail because booking is still CANCELLED, but it was found)
    expect(result.found).toBeGreaterThanOrEqual(1);
    expect(result.retried).toBeGreaterThanOrEqual(1);

    // The specific event should be in the details
    const detail = result.details.find(d => d.eventId === normalizedEvent.eventId);
    expect(detail).not.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. RETRY PROCESSES THE EVENT SUCCESSFULLY
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Successful retry after fixing root cause', () => {
  it('retry succeeds after fixing the booking state', async () => {
    // Create test data
    const user = await createTestUser('succ1');
    const org = await createTestOrg('succ1');
    const event = await createTestEvent(org.id, 'succ1');

    // Create ticket type for this event
    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'Recon Ticket',
        price: 10000,
        currency: 'GHS',
        quantity: 100,
        soldCount: 0,
        reservedCount: 0,
        minPerOrder: 1,
        maxPerOrder: 5,
        isActive: true,
      },
    });
    createdTicketTypeIds.push(ticketType.id);

    // Create booking in CANCELLED state initially (will cause failure)
    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 10000,
        currency: 'GHS',
        status: 'CANCELLED',
        bookingRef: `RECON-SUCC1-${Date.now()}`,
        cancellationReason: 'Will be fixed for retry',
      },
    });
    createdBookingIds.push(booking.id);

    const providerRef = `recon-succ1-ref-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: user.id,
        amount: 10000,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'PROCESSING',
        idempotencyKey: `recon-succ1-${Date.now()}`,
        providerRef,
        processedAt: new Date(),
      },
    });
    createdPaymentIds.push(payment.id);

    const normalizedEvent = makeNormalizedEvent({ eventReference: providerRef });

    // Process the event — will fail because booking is CANCELLED
    await expect(processWebhookEvent({ event: normalizedEvent })).rejects.toThrow();

    // Verify it failed
    const failedEvent = await prisma.paymentWebhookEvent.findUnique({
      where: { eventId: normalizedEvent.eventId },
    });
    expect(failedEvent!.processed).toBe(false);

    // Fix the booking: set it back to PENDING
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'PENDING',
        cancellationReason: null,
      },
    });

    // Run reconciliation
    const result = await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 24 });

    // The specific event should have been retried
    const detail = result.details.find(d => d.eventId === normalizedEvent.eventId);
    expect(detail).not.toBeUndefined();
    expect(detail!.outcome).toBe('succeeded');
    expect(result.succeeded).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. SUCCESSFUL RETRY MARKS IT PROCESSED=TRUE
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Successful retry marks processed=true', () => {
  it('after successful retry, event is marked processed=true in DB', async () => {
    // Create test data
    const user = await createTestUser('mark1');
    const org = await createTestOrg('mark1');
    const event = await createTestEvent(org.id, 'mark1');

    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'Recon Mark Ticket',
        price: 10000,
        currency: 'GHS',
        quantity: 100,
        soldCount: 0,
        reservedCount: 0,
        minPerOrder: 1,
        maxPerOrder: 5,
        isActive: true,
      },
    });
    createdTicketTypeIds.push(ticketType.id);

    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 10000,
        currency: 'GHS',
        status: 'CANCELLED',
        bookingRef: `RECON-MARK1-${Date.now()}`,
        cancellationReason: 'Will be fixed',
      },
    });
    createdBookingIds.push(booking.id);

    const providerRef = `recon-mark1-ref-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: user.id,
        amount: 10000,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'PROCESSING',
        idempotencyKey: `recon-mark1-${Date.now()}`,
        providerRef,
        processedAt: new Date(),
      },
    });
    createdPaymentIds.push(payment.id);

    const normalizedEvent = makeNormalizedEvent({ eventReference: providerRef });

    // Process — will fail
    await expect(processWebhookEvent({ event: normalizedEvent })).rejects.toThrow();

    // Fix the booking
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'PENDING', cancellationReason: null },
    });

    // Retry via reconciliation
    await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 24 });

    // Verify the event is now processed=true
    const processedEvent = await prisma.paymentWebhookEvent.findUnique({
      where: { eventId: normalizedEvent.eventId },
    });
    expect(processedEvent!.processed).toBe(true);
    expect(processedEvent!.processedAt).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. DUPLICATE RETRY CANNOT DOUBLE-CONFIRM (IDEMPOTENCY)
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Idempotency on duplicate retry', () => {
  it('re-running reconciliation on already-processed events is a no-op', async () => {
    // Create test data
    const user = await createTestUser('idem1');
    const org = await createTestOrg('idem1');
    const event = await createTestEvent(org.id, 'idem1');

    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'Recon Idem Ticket',
        price: 10000,
        currency: 'GHS',
        quantity: 100,
        soldCount: 0,
        reservedCount: 0,
        minPerOrder: 1,
        maxPerOrder: 5,
        isActive: true,
      },
    });
    createdTicketTypeIds.push(ticketType.id);

    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 10000,
        currency: 'GHS',
        status: 'PENDING',
        bookingRef: `RECON-IDEM1-${Date.now()}`,
      },
    });
    createdBookingIds.push(booking.id);

    const providerRef = `recon-idem1-ref-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: user.id,
        amount: 10000,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'PROCESSING',
        idempotencyKey: `recon-idem1-${Date.now()}`,
        providerRef,
        processedAt: new Date(),
      },
    });
    createdPaymentIds.push(payment.id);

    const normalizedEvent = makeNormalizedEvent({ eventReference: providerRef });

    // Process successfully the first time
    const firstResult = await processWebhookEvent({ event: normalizedEvent });
    expect(firstResult.processed).toBe(true);

    // Run reconciliation — should NOT find this event (it's already processed)
    const reconResult = await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 24 });

    const detail = reconResult.details.find(d => d.eventId === normalizedEvent.eventId);
    expect(detail).toBeUndefined(); // Not found by reconciliation

    // Verify payment was only confirmed once (status is COMPLETED, not double-processed)
    const finalPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(finalPayment!.status).toBe('COMPLETED');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. PERMANENT ERRORS REMAIN NON-RETRIABLE
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Permanent errors are non-retriable', () => {
  it('amount mismatch marks event processed=true (non-retriable)', async () => {
    // Create test data
    const user = await createTestUser('perm1');
    const org = await createTestOrg('perm1');
    const event = await createTestEvent(org.id, 'perm1');

    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        eventId: event.id,
        totalAmount: 10000,
        currency: 'GHS',
        status: 'PENDING',
        bookingRef: `RECON-PERM1-${Date.now()}`,
      },
    });
    createdBookingIds.push(booking.id);

    const providerRef = `recon-perm1-ref-${Date.now()}`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: user.id,
        amount: 10000,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'PROCESSING',
        idempotencyKey: `recon-perm1-${Date.now()}`,
        providerRef,
        processedAt: new Date(),
      },
    });
    createdPaymentIds.push(payment.id);

    // Create a webhook event with WRONG amount (permanent error)
    const wrongAmountEvent = makeNormalizedEvent({
      eventReference: providerRef,
      amount: asMoney(5000), // Wrong — payment is 10000
    });

    // Process — should throw WebhookAmountMismatch
    await expect(processWebhookEvent({ event: wrongAmountEvent })).rejects.toThrow(WebhookAmountMismatch);

    // The event should be marked as processed=true (non-retriable)
    const webhookEvent = await prisma.paymentWebhookEvent.findUnique({
      where: { eventId: wrongAmountEvent.eventId },
    });
    expect(webhookEvent).not.toBeNull();
    expect(webhookEvent!.processed).toBe(true); // Non-retriable!

    // Run reconciliation — should NOT find this event
    const reconResult = await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 24 });
    const detail = reconResult.details.find(d => d.eventId === wrongAmountEvent.eventId);
    expect(detail).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. ALREADY-PROCESSED EVENTS ARE SKIPPED
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Already-processed events are skipped', () => {
  it('events with processed=true are not found by reconciliation', async () => {
    // Directly insert a webhook event with processed=true
    const eventId = `recon-processed-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const webhookEvent = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: 'some-ref',
        payload: JSON.stringify({
          provider: 'PAYSTACK',
          eventId,
          eventType: 'charge.success',
          eventReference: 'some-ref',
          amount: 10000,
          currency: 'GHS',
          eventAt: new Date().toISOString(),
          isPaymentSuccess: true,
          isPaymentFailure: false,
        }),
        processed: true,
        processedAt: new Date(),
        processingError: null,
      },
    });
    createdWebhookEventIds.push(webhookEvent.id);

    // Run reconciliation — should NOT find this event
    const result = await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 24 });
    const detail = result.details.find(d => d.eventId === eventId);
    expect(detail).toBeUndefined();
  });

  it('events with processed=false but no processingError are not retried', async () => {
    // Insert a webhook event with processed=false but NO processingError
    // (This represents an event that was received but not yet attempted)
    const eventId = `recon-noerr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const webhookEvent = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: 'some-ref-2',
        payload: JSON.stringify({
          provider: 'PAYSTACK',
          eventId,
          eventType: 'charge.success',
          eventReference: 'some-ref-2',
          amount: 10000,
          currency: 'GHS',
          eventAt: new Date().toISOString(),
          isPaymentSuccess: true,
          isPaymentFailure: false,
        }),
        processed: false,
        processingError: null, // No error — not retriable
      },
    });
    createdWebhookEventIds.push(webhookEvent.id);

    // Run reconciliation — should NOT find this event
    const result = await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 24 });
    const detail = result.details.find(d => d.eventId === eventId);
    expect(detail).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. MAX AGE FILTER WORKS
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Max age filter', () => {
  it('events older than maxAgeHours are skipped', async () => {
    // Create an event that is "old" (createdAt in the past)
    const eventId = `recon-old-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const webhookEvent = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: 'old-ref',
        payload: JSON.stringify({
          provider: 'PAYSTACK',
          eventId,
          eventType: 'charge.success',
          eventReference: 'old-ref',
          amount: 10000,
          currency: 'GHS',
          eventAt: twoDaysAgo.toISOString(),
          isPaymentSuccess: true,
          isPaymentFailure: false,
        }),
        processed: false,
        processingError: 'Transient error from 2 days ago',
        createdAt: twoDaysAgo, // Override createdAt to be 2 days ago
      },
    });
    createdWebhookEventIds.push(webhookEvent.id);

    // Run reconciliation with maxAgeHours=1 (only retry events from last hour)
    const result = await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 1 });

    // The old event should NOT be found
    const detail = result.details.find(d => d.eventId === eventId);
    expect(detail).toBeUndefined();
  });

  it('events within maxAgeHours are found', async () => {
    // Create a recent event (within the last hour)
    const eventId = `recon-recent-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const webhookEvent = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'PAYSTACK',
        eventId,
        eventType: 'charge.success',
        eventReference: 'recent-ref',
        payload: JSON.stringify({
          provider: 'PAYSTACK',
          eventId,
          eventType: 'charge.success',
          eventReference: 'recent-ref',
          amount: 10000,
          currency: 'GHS',
          eventAt: new Date().toISOString(),
          isPaymentSuccess: true,
          isPaymentFailure: false,
        }),
        processed: false,
        processingError: 'Recent transient error',
      },
    });
    createdWebhookEventIds.push(webhookEvent.id);

    // Run reconciliation with maxAgeHours=1
    const result = await reconcileUnprocessedEvents({ limit: 100, maxAgeHours: 1 });

    // The recent event should be found
    const detail = result.details.find(d => d.eventId === eventId);
    expect(detail).not.toBeUndefined();
    // It will likely be skipped or still_failed since there's no matching payment,
    // but it was at least discovered (it appears in details)
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. LIMIT PARAMETER WORKS
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Limit parameter', () => {
  it('only processes up to limit events per call', async () => {
    // Create 3 unprocessed webhook events
    const eventIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const evtId = `recon-limit-${i}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      eventIds.push(evtId);

      const webhookEvent = await prisma.paymentWebhookEvent.create({
        data: {
          provider: 'PAYSTACK',
          eventId: evtId,
          eventType: 'charge.success',
          eventReference: `limit-ref-${i}`,
          payload: JSON.stringify({
            provider: 'PAYSTACK',
            eventId: evtId,
            eventType: 'charge.success',
            eventReference: `limit-ref-${i}`,
            amount: 10000,
            currency: 'GHS',
            eventAt: new Date().toISOString(),
            isPaymentSuccess: true,
            isPaymentFailure: false,
          }),
          processed: false,
          processingError: `Transient error ${i}`,
        },
      });
      createdWebhookEventIds.push(webhookEvent.id);
    }

    // Run reconciliation with limit=1
    const result = await reconcileUnprocessedEvents({ limit: 1, maxAgeHours: 24 });

    // Should have found all 3 but only processed 1
    expect(result.found).toBeGreaterThanOrEqual(3);
    expect(result.retried).toBeLessThanOrEqual(1);

    // Verify the remaining 2 are still unprocessed
    const remainingUnprocessed = await prisma.paymentWebhookEvent.findMany({
      where: {
        eventId: { in: eventIds },
        processed: false,
        processingError: { not: null },
      },
    });
    // At least 2 should still be unprocessed (the one that was retried might
    // still be unprocessed if it failed again, or might be processed if it succeeded)
    expect(remainingUnprocessed.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════

describe('Webhook Retry: Cleanup', () => {
  afterAll(async () => {
    // Clean up in reverse dependency order

    // Webhook events
    for (const id of createdWebhookEventIds) {
      await prisma.paymentWebhookEvent.delete({ where: { id } }).catch(() => {});
    }

    // Payments (must delete before bookings due to unique relation)
    for (const id of createdPaymentIds) {
      // Delete related records first
      await prisma.paymentAttempt.deleteMany({ where: { paymentId: id } }).catch(() => {});
      await prisma.refund.deleteMany({ where: { paymentId: id } }).catch(() => {});
      await prisma.payment.delete({ where: { id } }).catch(() => {});
    }

    // Bookings + their tickets
    for (const id of createdBookingIds) {
      await prisma.ticket.deleteMany({ where: { bookingId: id } }).catch(() => {});
      await prisma.booking.delete({ where: { id } }).catch(() => {});
    }

    // Ticket types
    for (const id of createdTicketTypeIds) {
      await prisma.ticketType.delete({ where: { id } }).catch(() => {});
    }

    // Events
    for (const id of createdEventIds) {
      await prisma.event.delete({ where: { id } }).catch(() => {});
    }

    // Users (orgs + regular users)
    const allUserIds = [...createdUserIds, ...createdOrgIds];
    for (const id of allUserIds) {
      await prisma.refreshToken.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  it('placeholder to ensure afterAll runs', () => {
    expect(true).toBe(true);
  });
});
