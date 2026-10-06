/**
 * Phase 5E Stage 4: Paystack HTTP Client
 *
 * Low-level HTTP client for Paystack API calls.
 *
 * Security:
 *   - Secret key is NEVER logged or returned in errors
 *   - All requests use server-side secret key (Bearer auth)
 *   - Timeouts prevent hanging connections
 *   - PaymentAttempt recording for audit trail
 *
 * Sandbox vs Production:
 *   - Same base URL (https://api.paystack.co)
 *   - Test/live mode determined by key prefix (sk_test_ vs sk_live_)
 *   - We only use sk_test_ keys in this integration
 */

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { createPaymentAttempt } from '../payment-attempt';

// ─── Types ───

export interface PaystackHttpRequest {
  method: 'GET' | 'POST';
  path: string;
  /** Request body (for POST) */
  body?: Record<string, unknown>;
  /** Payment ID for PaymentAttempt recording */
  paymentId?: string;
  /** Idempotency key for the request */
  idempotencyKey?: string;
}

export interface PaystackHttpResponse {
  status: number;
  /** Paystack API response status flag */
  apiStatus: boolean;
  /** Paystack API response message */
  apiMessage: string;
  /** Response data (typed by caller) */
  data: unknown;
}

export interface PaystackHttpError {
  status: number;
  apiStatus: boolean;
  apiMessage: string;
  /** Machine-readable error code */
  errorCode: string;
  /** Whether retrying might succeed */
  retryable: boolean;
}

// ─── Configuration ───

/** Request timeout in milliseconds */
const PAYSTACK_REQUEST_TIMEOUT_MS = 10_000;

/** Maximum number of retries for transient failures */
const MAX_RETRIES = 1;

/** HTTP status codes that indicate transient/retryable failures */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

// ─── Amount Conversion ───

/**
 * Convert our internal integer minor units to the amount Paystack expects.
 *
 * Our internal format: GHS 100.00 → 10000 (integer pesewas)
 * Paystack expects:    GHS 100.00 → 10000 (pesewas/kobo/cents)
 *
 * For 2-decimal currencies (GHS, USD, NGN, etc.), these are IDENTICAL.
 * For 0-decimal currencies (JPY, KRW), these are also IDENTICAL.
 *
 * This function exists as an EXPLICIT AUDIT POINT for the conversion.
 * If a new currency with different Paystack handling is added,
 * this is where the logic goes.
 *
 * @param minorUnits - Amount in our internal integer minor units
 * @param currency - ISO 4217 currency code
 * @returns Amount to send to Paystack (same value for all currently supported currencies)
 */
export function toPaystackAmount(minorUnits: number, _currency: string): number {
  // For all currently supported currencies, our internal minor-unit representation
  // is identical to Paystack's expected format. No conversion needed.
  // This function validates the amount is a positive integer.
  if (!Number.isInteger(minorUnits) || minorUnits < 0) {
    throw new Error(`Invalid Paystack amount: expected non-negative integer, got ${minorUnits}`);
  }
  return minorUnits;
}

/**
 * Convert Paystack amount back to our internal integer minor units.
 *
 * Same as toPaystackAmount — identity function for all supported currencies.
 * Exists as an explicit audit point for the reverse conversion.
 *
 * @param paystackAmount - Amount from Paystack response
 * @param currency - ISO 4217 currency code
 * @returns Amount in our internal integer minor units
 */
export function fromPaystackAmount(paystackAmount: number, _currency: string): number {
  if (!Number.isInteger(paystackAmount) || paystackAmount < 0) {
    throw new Error(`Invalid Paystack amount in response: expected non-negative integer, got ${paystackAmount}`);
  }
  return paystackAmount;
}

// ─── Core: Make Paystack API Request ───

/**
 * Make an HTTP request to the Paystack API.
 *
 * Handles:
 *   - Authorization header with secret key
 *   - JSON serialization/deserialization
 *   - Timeouts
 *   - Error normalization
 *   - PaymentAttempt recording
 *   - Retry for transient failures
 *
 * NEVER exposes the secret key in logs or error messages.
 */
export async function paystackRequest(
  request: PaystackHttpRequest,
): Promise<PaystackHttpResponse> {
  const { method, path, body, paymentId, idempotencyKey } = request;
  const baseUrl = env.PAYSTACK_BASE_URL;
  const url = `${baseUrl}${path}`;

  let lastError: PaystackHttpError | null = null;
  const maxAttempts = 1 + MAX_RETRIES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Build request headers — secret key NEVER appears in logs
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      // Build fetch options
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(PAYSTACK_REQUEST_TIMEOUT_MS),
      };

      if (method === 'POST' && body) {
        fetchOptions.body = JSON.stringify(body);
      }

      logger.debug('Paystack API request', {
        method,
        path,
        attempt: attempt + 1,
        hasBody: !!body,
        paymentId: paymentId ?? 'none',
      });

      const response = await fetch(url, fetchOptions);
      const responseText = await response.text();

      // Parse response JSON
      let responseData: {
        status?: boolean;
        message?: string;
        data?: unknown;
      };

      try {
        responseData = JSON.parse(responseText);
      } catch {
        // Non-JSON response from Paystack
        const error: PaystackHttpError = {
          status: response.status,
          apiStatus: false,
          apiMessage: `Non-JSON response from Paystack: ${responseText.substring(0, 200)}`,
          errorCode: 'PAYSTACK_INVALID_RESPONSE',
          retryable: false,
        };

        // Record attempt
        if (paymentId) {
          await recordAttempt(paymentId, method, path, body, {
            status: response.status,
            body: responseText.substring(0, 1000),
          }, 'FAILED', error.apiMessage, idempotencyKey);
        }

        lastError = error;
        if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
          continue; // Retry
        }
        throw new PaystackApiError(error);
      }

      const apiStatus = responseData.status === true;
      const apiMessage = responseData.message ?? '';

      // Record successful request
      if (paymentId) {
        const attemptStatus = apiStatus ? 'SUCCESS' : 'FAILED';
        await recordAttempt(paymentId, method, path, body, responseData, attemptStatus, apiStatus ? undefined : apiMessage, idempotencyKey);
      }

      if (!apiStatus) {
        // Paystack returned an error response
        const errorCode = mapPaystackErrorCode(response.status, apiMessage);
        const error: PaystackHttpError = {
          status: response.status,
          apiStatus: false,
          apiMessage,
          errorCode,
          retryable: RETRYABLE_STATUS_CODES.has(response.status),
        };

        lastError = error;

        if (error.retryable && attempt < MAX_RETRIES) {
          continue; // Retry
        }

        // Non-retryable or exhausted retries — throw
        logger.warn('Paystack API error response', {
          method,
          path,
          status: response.status,
          apiMessage,
          errorCode,
        });
        throw new PaystackApiError(error);
      }

      // Success
      return {
        status: response.status,
        apiStatus: true,
        apiMessage,
        data: responseData.data,
      };
    } catch (fetchError) {
      if (fetchError instanceof PaystackApiError) {
        throw fetchError; // Already handled above
      }

      // Network/timeout error
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown fetch error';
      const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('abort');
      const error: PaystackHttpError = {
        status: 0,
        apiStatus: false,
        apiMessage: isTimeout ? 'Paystack request timed out' : `Network error: ${errorMessage}`,
        errorCode: isTimeout ? 'PAYSTACK_TIMEOUT' : 'PAYSTACK_NETWORK_ERROR',
        retryable: !isTimeout, // Timeouts are not retried (idempotency risk for POSTs)
      };

      lastError = error;

      logger.warn('Paystack API network error', {
        method,
        path,
        attempt: attempt + 1,
        errorCode: error.errorCode,
        retryable: error.retryable,
      });

      // Record attempt
      if (paymentId) {
        await recordAttempt(paymentId, method, path, body, null, 'FAILED', error.apiMessage, idempotencyKey);
      }

      if (error.retryable && attempt < MAX_RETRIES) {
        continue; // Retry
      }

      throw new PaystackApiError(error);
    }
  }

  // All retries exhausted
  throw new PaystackApiError(lastError!);
}

// ─── Error Class ───

export class PaystackApiError extends Error {
  readonly status: number;
  readonly apiStatus: boolean;
  readonly apiMessage: string;
  readonly errorCode: string;
  readonly retryable: boolean;

  constructor(error: PaystackHttpError) {
    super(`Paystack API error: ${error.apiMessage} (code: ${error.errorCode})`);
    this.name = 'PaystackApiError';
    this.status = error.status;
    this.apiStatus = error.apiStatus;
    this.apiMessage = error.apiMessage;
    this.errorCode = error.errorCode;
    this.retryable = error.retryable;
  }
}

// ─── Helpers ───

/**
 * Map Paystack HTTP status + message to a machine-readable error code.
 */
function mapPaystackErrorCode(httpStatus: number, apiMessage: string): string {
  if (httpStatus === 401) return 'PAYSTACK_AUTH_ERROR';
  if (httpStatus === 403) return 'PAYSTACK_FORBIDDEN';
  if (httpStatus === 404) return 'PAYSTACK_NOT_FOUND';
  if (httpStatus === 422) return 'PAYSTACK_VALIDATION_ERROR';
  if (httpStatus === 429) return 'PAYSTACK_RATE_LIMITED';

  // Paystack-specific messages
  const lower = apiMessage.toLowerCase();
  if (lower.includes('duplicate')) return 'PAYSTACK_DUPLICATE_REFERENCE';
  if (lower.includes('invalid')) return 'PAYSTACK_INVALID_REQUEST';
  if (lower.includes('amount')) return 'PAYSTACK_AMOUNT_ERROR';

  if (httpStatus >= 500) return 'PAYSTACK_SERVER_ERROR';
  return 'PAYSTACK_API_ERROR';
}

/**
 * Record a PaymentAttempt for audit trail.
 * Payloads are automatically redacted by createPaymentAttempt.
 */
async function recordAttempt(
  paymentId: string,
  method: string,
  path: string,
  requestBody: Record<string, unknown> | undefined,
  responseData: unknown,
  status: 'PENDING' | 'SUCCESS' | 'FAILED',
  failureReason?: string,
  providerRef?: string,
): Promise<void> {
  try {
    await createPaymentAttempt({
      paymentId,
      provider: 'PAYSTACK',
      providerRef: providerRef ?? undefined,
      status,
      requestPayload: {
        method,
        path,
        // Note: body is redacted by createPaymentAttempt (removes auth headers, keys, etc.)
        // But we also omit email from the request payload for extra safety
        body: requestBody ? sanitizeRequestBody(requestBody) : undefined,
      },
      responsePayload: responseData ? { status, data: responseData } : undefined,
      failureReason,
    });
  } catch (recordError) {
    // PaymentAttempt recording failure should NEVER prevent the operation
    logger.error('Failed to record PaymentAttempt', {
      paymentId,
      method,
      path,
      error: recordError instanceof Error ? recordError.message : 'Unknown',
    });
  }
}

/**
 * Sanitize request body before recording in PaymentAttempt.
 * Removes fields that shouldn't be stored even in redacted form.
 */
function sanitizeRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    // Never store these fields even with redaction
    if (key === 'email' || key === 'phone' || key === 'name') {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
