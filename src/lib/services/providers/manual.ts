/**
 * Phase 5E Stage 2: Manual Payment Provider
 *
 * For payments handled outside the automated flow (bank transfer, cash, etc.).
 * An organizer manually confirms payment after receiving funds.
 *
 * - initializePayment: Returns success with no authorization URL (organizer action required)
 * - verifyPayment: Always fails — manual verification is done by the organizer, not programmatically
 * - processWebhook: Always fails — manual payments have no webhooks
 * - requestRefund: Integration pending
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
import { ProviderIntegrationPending } from '../payment-domain-errors';

class ManualProvider implements IPaymentProvider {
  readonly name = 'MANUAL' as const;

  async initializePayment(request: InitializePaymentRequest): Promise<InitializePaymentOutcome> {
    // Manual payments are "initialized" but require organizer action to confirm.
    // No authorization URL — the organizer handles payment collection externally.
    return {
      success: true,
      providerReference: `manual-${request.paymentId}`,
      authorizationUrl: null,
    };
  }

  async verifyPayment(_request: VerifyPaymentRequest): Promise<VerifyPaymentOutcome> {
    // Manual verification is not programmatic — the organizer confirms manually.
    return {
      success: false,
      errorCode: 'MANUAL_VERIFICATION_NOT_SUPPORTED',
      errorMessage: 'Manual payments must be verified by the organizer through the dashboard, not programmatically.',
      isPending: true,
    };
  }

  async processWebhook(_request: ProcessWebhookRequest): Promise<ProcessWebhookOutcome> {
    return {
      success: false,
      errorCode: 'MANUAL_NO_WEBHOOKS',
      errorMessage: 'Manual payments do not produce webhook events.',
    };
  }

  async requestRefund(_request: RequestRefundRequest): Promise<RequestRefundOutcome> {
    throw new ProviderIntegrationPending('MANUAL', 'requestRefund');
  }
}

/** Singleton Manual provider adapter */
export const manualProvider = new ManualProvider();
