/**
 * Phase 5E Stage 4: Paystack Provider Adapter — Full Implementation
 *
 * Implements the IPaymentProvider interface for Paystack.
 *
 * CRITICAL SECURITY BOUNDARIES:
 *   - Secret key is NEVER exposed to the browser
 *   - All API calls use server-side secret key
 *   - Payment verification is ALWAYS server-side
 *   - Webhook signature uses raw body + timing-safe comparison
 *   - Amounts are in integer minor units (no floating-point)
 *
 * SANDBOX ONLY:
 *   - Uses sk_test_ keys only
 *   - Does NOT process real customer money
 *   - Does NOT change production configuration
 *
 * Paystack API Reference:
 *   - Initialize: POST /transaction/initialize
 *   - Verify:     GET  /transaction/verify/:reference
 *   - Refund:     POST /refund
 *   - Webhook:    charge.success, charge.failed events
 */

import type {
  IPaymentProvider,
  InitializePaymentRequest,
  InitializePaymentOutcome,
  VerifyPaymentRequest,
  VerifyPaymentOutcome,
  ProcessWebhookRequest,
  ProcessWebhookOutcome,
  NormalizedWebhookEvent,
  RequestRefundRequest,
  RequestRefundOutcome,
} from '../payment-provider';
import { paystackRequest, toPaystackAmount, fromPaystackAmount, PaystackApiError } from './paystack-http';
import { logger } from '@/lib/logger';

// ─── Paystack API Response Types ───

interface PaystackInitializeResponse {
  reference: string;
  authorization_url: string;
  access_code: string;
}

interface PaystackVerifyData {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at: string;
  channel: string;
  gateway_response: string;
  metadata?: Record<string, unknown>;
}

interface PaystackRefundResponse {
  id: number;
  ref: string;
  status: string;
  transaction: {
    id: number;
    reference: string;
  };
}

// ─── Paystack Webhook Payload Types ───

interface PaystackWebhookPayload {
  event: string;
  data: {
    id: number;
    reference: string;
    amount: number;
    currency: string;
    status: string;
    paid_at?: string;
    channel?: string;
    gateway_response?: string;
    [key: string]: unknown;
  };
}

// ─── Provider Implementation ───

class PaystackProvider implements IPaymentProvider {
  readonly name = 'PAYSTACK' as const;

  // ─── Initialize Payment ───

  /**
   * Initialize a transaction with Paystack.
   *
   * Sends a server-side POST to /transaction/initialize with:
   *   - amount in Paystack's expected minor units
   *   - currency code
   *   - customer email
   *   - reference (from idempotencyKey)
   *   - callback_url (for browser redirect after payment)
   *   - metadata (for additional context)
   *
   * Returns the authorization URL for browser redirect and
   * the Paystack reference for tracking.
   *
   * The secret key is included in the Authorization header
   * by paystackRequest() and is NEVER logged or exposed.
   */
  async initializePayment(request: InitializePaymentRequest): Promise<InitializePaymentOutcome> {
    const { paymentId, amount, currency, customer, callbackUrl, idempotencyKey, metadata } = request;

    // Convert amount to Paystack format (identity for supported currencies, but explicit)
    const paystackAmount = toPaystackAmount(amount, currency);

    // Build request body
    const body: Record<string, unknown> = {
      amount: paystackAmount,
      email: customer.email,
      currency,
      reference: idempotencyKey, // Use idempotencyKey as Paystack reference
      metadata: {
        paymentId,
        userId: customer.userId,
        ...(customer.name && { customerName: customer.name }),
        ...(customer.phone && { customerPhone: customer.phone }),
        ...(metadata ?? {}),
      },
    };

    // Add callback URL if provided
    if (callbackUrl) {
      body.callback_url = callbackUrl;
    }

    try {
      const response = await paystackRequest({
        method: 'POST',
        path: '/transaction/initialize',
        body,
        paymentId,
        idempotencyKey,
      });

      const data = response.data as PaystackInitializeResponse;

      logger.info('Paystack payment initialized', {
        paymentId,
        providerReference: data.reference,
        hasAuthorizationUrl: !!data.authorization_url,
      });

      return {
        success: true,
        providerReference: data.reference,
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
      };
    } catch (error) {
      if (error instanceof PaystackApiError) {
        logger.warn('Paystack initializePayment failed', {
          paymentId,
          errorCode: error.errorCode,
          apiMessage: error.apiMessage,
          retryable: error.retryable,
        });

        return {
          success: false,
          errorCode: error.errorCode,
          errorMessage: `Paystack initialization failed: ${error.apiMessage}`,
          retryable: error.retryable,
        };
      }

      // Unexpected error
      logger.error('Paystack initializePayment unexpected error', {
        paymentId,
        error: error instanceof Error ? error.message : 'Unknown',
      });

      return {
        success: false,
        errorCode: 'PAYSTACK_UNEXPECTED_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unexpected error during Paystack initialization',
        retryable: false,
      };
    }
  }

  // ─── Verify Payment ───

  /**
   * Verify a payment's status directly with Paystack.
   *
   * CRITICAL: This is the ONLY mechanism that can set Payment → COMPLETED.
   * The browser returning to the callback URL is NOT verification.
   * A user-submitted reference is NOT verification.
   *
   * This method:
   *   1. Calls Paystack GET /transaction/verify/:reference
   *   2. Validates the response status, amount, and currency
   *   3. Returns verified result ONLY if Paystack confirms success
   *
   * The caller (verify route) then calls confirmBookingOnPaymentSuccess()
   * to atomically update Payment, Booking, Inventory, and Tickets.
   */
  async verifyPayment(request: VerifyPaymentRequest): Promise<VerifyPaymentOutcome> {
    const { paymentId, providerReference, expectedAmount, expectedCurrency } = request;

    try {
      const response = await paystackRequest({
        method: 'GET',
        path: `/transaction/verify/${encodeURIComponent(providerReference)}`,
        paymentId,
        idempotencyKey: providerReference,
      });

      const data = response.data as PaystackVerifyData;

      // Paystack returns status as lowercase string
      const paystackStatus = data.status?.toLowerCase();

      if (paystackStatus === 'success') {
        // Verify amount matches (convert from Paystack format back to internal)
        const verifiedAmount = fromPaystackAmount(data.amount, data.currency ?? expectedCurrency);

        if (verifiedAmount !== expectedAmount) {
          logger.warn('Paystack verification: amount mismatch', {
            paymentId,
            providerReference,
            expectedAmount,
            verifiedAmount,
            paystackAmount: data.amount,
          });

          return {
            success: false,
            errorCode: 'PAYSTACK_AMOUNT_MISMATCH',
            errorMessage: `Amount mismatch: expected ${expectedAmount}, Paystack reports ${verifiedAmount}`,
          };
        }

        // Verify currency matches
        const verifiedCurrency = (data.currency ?? '').toUpperCase();
        if (verifiedCurrency !== expectedCurrency.toUpperCase()) {
          logger.warn('Paystack verification: currency mismatch', {
            paymentId,
            providerReference,
            expectedCurrency,
            verifiedCurrency,
          });

          return {
            success: false,
            errorCode: 'PAYSTACK_CURRENCY_MISMATCH',
            errorMessage: `Currency mismatch: expected ${expectedCurrency}, Paystack reports ${verifiedCurrency}`,
          };
        }

        logger.info('Paystack payment verified successfully', {
          paymentId,
          providerReference,
          verifiedAmount,
          verifiedCurrency,
        });

        return {
          success: true,
          verifiedAmount: verifiedAmount as typeof expectedAmount,
          verifiedCurrency,
          providerReference: data.reference ?? providerReference,
          paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
        };
      }

      if (paystackStatus === 'pending' || paystackStatus === 'abandoned') {
        // Payment is still pending at Paystack
        logger.info('Paystack verification: payment still pending', {
          paymentId,
          providerReference,
          paystackStatus,
        });

        return {
          success: false,
          errorCode: 'PAYSTACK_PAYMENT_PENDING',
          errorMessage: `Payment is ${paystackStatus} at Paystack. Not yet completed.`,
          isPending: true,
        };
      }

      // Payment failed at Paystack (failed, rejected, etc.)
      logger.warn('Paystack verification: payment failed', {
        paymentId,
        providerReference,
        paystackStatus,
        gatewayResponse: data.gateway_response,
      });

      return {
        success: false,
        errorCode: 'PAYSTACK_PAYMENT_FAILED',
        errorMessage: `Payment failed at Paystack. Status: ${paystackStatus}. ${data.gateway_response ?? ''}`,
      };
    } catch (error) {
      if (error instanceof PaystackApiError) {
        // If Paystack returns 404 for the reference, it means the transaction doesn't exist
        if (error.errorCode === 'PAYSTACK_NOT_FOUND') {
          return {
            success: false,
            errorCode: 'PAYSTACK_REFERENCE_NOT_FOUND',
            errorMessage: `Transaction reference "${providerReference}" not found at Paystack.`,
          };
        }

        logger.warn('Paystack verifyPayment API error', {
          paymentId,
          providerReference,
          errorCode: error.errorCode,
          retryable: error.retryable,
        });

        return {
          success: false,
          errorCode: error.errorCode,
          errorMessage: `Paystack verification failed: ${error.apiMessage}`,
          isPending: error.retryable, // If retryable, it might still be pending
        };
      }

      logger.error('Paystack verifyPayment unexpected error', {
        paymentId,
        providerReference,
        error: error instanceof Error ? error.message : 'Unknown',
      });

      return {
        success: false,
        errorCode: 'PAYSTACK_UNEXPECTED_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unexpected error during Paystack verification',
      };
    }
  }

  // ─── Process Webhook ───

  /**
   * Parse and normalize a Paystack webhook payload.
   *
   * This method:
   *   1. Parses the raw JSON payload
   *   2. Extracts and normalizes the event data
   *   3. Converts amounts from Paystack format to internal format
   *   4. Determines if the event indicates success or failure
   *
   * IMPORTANT: Signature verification is done by the webhook route
   * BEFORE calling this method. This method assumes the payload
   * has already been verified as authentic.
   *
   * The normalized event is then passed to processWebhookEvent()
   * which handles deduplication, payment lookup, amount/currency
   * validation, and financial state transitions.
   */
  async processWebhook(request: ProcessWebhookRequest): Promise<ProcessWebhookOutcome> {
    const { rawPayload } = request;

    let payload: PaystackWebhookPayload;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      return {
        success: false,
        errorCode: 'PAYSTACK_WEBHOOK_INVALID_JSON',
        errorMessage: 'Failed to parse Paystack webhook payload as JSON',
      };
    }

    // Validate required fields
    if (!payload.event || !payload.data) {
      return {
        success: false,
        errorCode: 'PAYSTACK_WEBHOOK_MALFORMED',
        errorMessage: 'Paystack webhook payload missing event or data field',
      };
    }

    const { event, data } = payload;

    // Extract and validate required data fields
    if (!data.id) {
      return {
        success: false,
        errorCode: 'PAYSTACK_WEBHOOK_MISSING_EVENT_ID',
        errorMessage: 'Paystack webhook data.id is missing',
      };
    }

    if (!data.reference) {
      return {
        success: false,
        errorCode: 'PAYSTACK_WEBHOOK_MISSING_REFERENCE',
        errorMessage: 'Paystack webhook data.reference is missing',
      };
    }

    // Determine currency (default to GHS if not provided)
    const currency = (data.currency ?? 'GHS').toUpperCase();

    // Convert amount from Paystack format to internal minor units
    let amount: number;
    try {
      amount = fromPaystackAmount(data.amount ?? 0, currency);
    } catch {
      return {
        success: false,
        errorCode: 'PAYSTACK_WEBHOOK_INVALID_AMOUNT',
        errorMessage: `Invalid amount in Paystack webhook: ${data.amount}`,
      };
    }

    // Determine event type
    const isPaymentSuccess = event === 'charge.success';
    const isPaymentFailure = event === 'charge.failed';

    const normalized: NormalizedWebhookEvent = {
      provider: 'PAYSTACK',
      eventId: `paystack-${data.id}`,
      eventType: event,
      eventReference: data.reference,
      amount: amount as NormalizedWebhookEvent['amount'],
      currency,
      eventAt: data.paid_at ? new Date(data.paid_at) : new Date(),
      isPaymentSuccess,
      isPaymentFailure,
    };

    logger.info('Paystack webhook normalized', {
      eventType: event,
      eventId: normalized.eventId,
      eventReference: data.reference,
      isPaymentSuccess,
      isPaymentFailure,
    });

    return {
      success: true,
      event: normalized,
    };
  }

  // ─── Request Refund ───

  /**
   * Request a refund from Paystack.
   *
   * Sends POST /refund with:
   *   - transaction: the original Paystack reference
   *   - amount: refund amount in minor units
   *   - currency
   *   - reason (optional)
   *
   * Note: Paystack refunds are asynchronous. The refund status
   * will be updated via webhook or manual reconciliation.
   */
  async requestRefund(request: RequestRefundRequest): Promise<RequestRefundOutcome> {
    const { paymentId, providerReference, amount, currency, reason } = request;

    // Convert amount to Paystack format
    const paystackAmount = toPaystackAmount(amount, currency);

    const body: Record<string, unknown> = {
      transaction: providerReference,
      amount: paystackAmount,
      currency,
      ...(reason && { reason }),
    };

    try {
      const response = await paystackRequest({
        method: 'POST',
        path: '/refund',
        body,
        paymentId,
        idempotencyKey: `refund-${paymentId}`,
      });

      const data = response.data as PaystackRefundResponse;

      logger.info('Paystack refund initiated', {
        paymentId,
        providerReference,
        refundReference: data.ref,
        refundStatus: data.status,
      });

      return {
        success: true,
        refundReference: data.ref,
      };
    } catch (error) {
      if (error instanceof PaystackApiError) {
        logger.warn('Paystack requestRefund failed', {
          paymentId,
          providerReference,
          errorCode: error.errorCode,
          apiMessage: error.apiMessage,
          retryable: error.retryable,
        });

        return {
          success: false,
          errorCode: error.errorCode,
          errorMessage: `Paystack refund failed: ${error.apiMessage}`,
          retryable: error.retryable,
        };
      }

      logger.error('Paystack requestRefund unexpected error', {
        paymentId,
        providerReference,
        error: error instanceof Error ? error.message : 'Unknown',
      });

      return {
        success: false,
        errorCode: 'PAYSTACK_UNEXPECTED_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unexpected error during Paystack refund',
        retryable: false,
      };
    }
  }
}

/** Singleton Paystack adapter (full implementation) */
export const paystackProvider = new PaystackProvider();
