/**
 * Phase 5E Stage 2: Payment Attempt Service
 *
 * Service for creating and managing PaymentAttempt records.
 * Every provider payment interaction should be recorded as a PaymentAttempt
 * for debugging, auditing, and retry decisions.
 *
 * Security: Never store secrets, auth headers, or API keys in payloads.
 * Use redaction for sensitive fields.
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface CreatePaymentAttemptParams {
  paymentId: string;
  provider: string;
  providerRef?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  failureReason?: string;
}

// ─── Payload Sanitization ───

/**
 * Keys that must NEVER be stored in request/response payloads.
 * Even in non-production environments, these must be redacted.
 */
const SENSITIVE_PAYLOAD_KEYS = new Set([
  'authorization',
  'Authorization',
  'secret_key',
  'secretKey',
  'api_key',
  'apiKey',
  'password',
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'card_number',
  'cardNumber',
  'cvv',
  'pin',
]);

/**
 * Redact sensitive fields from a payload object.
 * Returns a new object with sensitive values replaced by '[REDACTED]'.
 * Recursively redacts nested objects.
 */
function redactPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(redactPayload);

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_PAYLOAD_KEYS.has(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactPayload(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// ─── Core: Create Payment Attempt ───

/**
 * Create a PaymentAttempt record.
 * Payloads are automatically redacted to prevent storing secrets.
 */
export async function createPaymentAttempt(
  params: CreatePaymentAttemptParams,
): Promise<{ id: string; createdAt: Date }> {
  const safeRequestPayload = params.requestPayload
    ? JSON.stringify(redactPayload(params.requestPayload))
    : null;

  const safeResponsePayload = params.responsePayload
    ? JSON.stringify(redactPayload(params.responsePayload))
    : null;

  const attempt = await db.paymentAttempt.create({
    data: {
      paymentId: params.paymentId,
      provider: params.provider,
      providerRef: params.providerRef ?? null,
      status: params.status,
      requestPayload: safeRequestPayload,
      responsePayload: safeResponsePayload,
      failureReason: params.failureReason ?? null,
    },
    select: { id: true, createdAt: true },
  });

  logger.info('PaymentAttempt created', {
    paymentAttemptId: attempt.id,
    paymentId: params.paymentId,
    provider: params.provider,
    status: params.status,
  });

  return attempt;
}

// ─── Core: Get Attempts for Payment ───

/**
 * Get all payment attempts for a given payment, ordered by creation time.
 */
export async function getPaymentAttempts(paymentId: string): Promise<
  Array<{
    id: string;
    provider: string;
    providerRef: string | null;
    status: string;
    failureReason: string | null;
    createdAt: Date;
  }>
> {
  return db.paymentAttempt.findMany({
    where: { paymentId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      providerRef: true,
      status: true,
      failureReason: true,
      createdAt: true,
    },
  });
}
