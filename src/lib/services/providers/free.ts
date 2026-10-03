/**
 * Phase 5E Stage 2: Free Payment Provider
 *
 * For zero-cost events/tickets where no payment is needed.
 * A FREE payment is immediately COMPLETED upon initialization.
 *
 * - initializePayment: Returns success immediately (no payment needed)
 * - verifyPayment: Returns success (free payments are always "verified")
 * - processWebhook: Always fails — free payments have no webhooks
 * - requestRefund: N/A for free payments
 */

import type {
  IPaymentProvider,
  InitializePaymentRequest,
  InitializePaymentOutcome,
  VerifyPaymentRequest,
  VerifyPaymentOutcome,
  ProcessWebhookRequest,
  ProcessWebhookOutcome,
  RequestRefundRequest,
  RequestRefundOutcome,
} from '../payment-provider';

class FreeProvider implements IPaymentProvider {
  readonly name = 'FREE' as const;

  async initializePayment(request: InitializePaymentRequest): Promise<InitializePaymentOutcome> {
    // Free payments are immediately "initialized" — no money changes hands.
    return {
      success: true,
      providerReference: `free-${request.paymentId}`,
      authorizationUrl: null,
    };
  }

  async verifyPayment(request: VerifyPaymentRequest): Promise<VerifyPaymentOutcome> {
    // Free payments are always "verified" — no money was owed.
    return {
      success: true,
      verifiedAmount: request.expectedAmount,
      verifiedCurrency: request.expectedCurrency,
      providerReference: `free-${request.paymentId}`,
      paidAt: new Date(),
    };
  }

  async processWebhook(_request: ProcessWebhookRequest): Promise<ProcessWebhookOutcome> {
    return {
      success: false,
      errorCode: 'FREE_NO_WEBHOOKS',
      errorMessage: 'Free payments do not produce webhook events.',
    };
  }

  async requestRefund(_request: RequestRefundRequest): Promise<RequestRefundOutcome> {
    // Refunds don't make sense for free payments
    return {
      success: false,
      errorCode: 'FREE_NO_REFUNDS',
      errorMessage: 'Free payments cannot be refunded — no money was collected.',
      retryable: false,
    };
  }
}

/** Singleton Free provider adapter */
export const freeProvider = new FreeProvider();
