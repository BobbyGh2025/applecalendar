/**
 * Phase 6: Notification Channel Interface
 *
 * Defines the contract for notification delivery channels.
 * Each channel (IN_APP, EMAIL, SMS) implements this interface.
 *
 * Design decisions:
 *   - Channels are stateless — all state is in the Notification record
 *   - Channels return a result; they do NOT throw on delivery failure
 *   - The notification service handles retries and status updates
 *   - Mock channels are used in tests; real providers plugged in later
 */

import { logger } from '@/lib/logger';

// ─── Channel result ───

export interface ChannelDeliveryResult {
  /** Whether the delivery attempt succeeded */
  success: boolean;
  /** Provider-specific message ID (for tracking) */
  providerId?: string;
  /** Error message if delivery failed */
  error?: string;
  /** Whether the failure is permanent (don't retry) */
  permanent?: boolean;
}

// ─── Notification payload ───

export interface NotificationPayload {
  notificationId: string;
  userId: string;
  userEmail: string;
  userName: string;
  userPhone?: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  eventId?: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
}

// ─── Channel interface ───

export interface NotificationChannel {
  /** Channel identifier: 'IN_APP' | 'EMAIL' | 'SMS' */
  readonly channel: string;

  /**
   * Send a notification through this channel.
   * Must NOT throw — return a failed result instead.
   */
  send(payload: NotificationPayload): Promise<ChannelDeliveryResult>;
}

// ─── In-App Channel (always succeeds — just a DB record) ───

export class InAppChannel implements NotificationChannel {
  readonly channel = 'IN_APP';

  async send(payload: NotificationPayload): Promise<ChannelDeliveryResult> {
    // In-app notifications are just database records.
    // The notification is already created in the DB before dispatch,
    // so this always succeeds.
    logger.debug('In-app notification delivered', {
      notificationId: payload.notificationId,
      userId: payload.userId,
    });
    return { success: true, providerId: payload.notificationId };
  }
}

// ─── Mock Email Channel (for tests and development) ───

export class MockEmailChannel implements NotificationChannel {
  readonly channel = 'EMAIL';

  /** Track sent emails for test assertions */
  readonly sent: NotificationPayload[] = [];

  /** Configurable failure simulation */
  private readonly shouldFail: boolean;

  constructor(options?: { shouldFail?: boolean }) {
    this.shouldFail = options?.shouldFail ?? false;
  }

  async send(payload: NotificationPayload): Promise<ChannelDeliveryResult> {
    this.sent.push(payload);

    if (this.shouldFail) {
      logger.debug('Mock email channel — simulated failure', {
        notificationId: payload.notificationId,
        to: payload.userEmail,
      });
      return { success: false, error: 'Mock email failure', permanent: false };
    }

    logger.debug('Mock email channel — would send', {
      notificationId: payload.notificationId,
      to: payload.userEmail,
      subject: payload.title,
    });
    return {
      success: true,
      providerId: `mock-email-${payload.notificationId}`,
    };
  }
}

// ─── Mock SMS Channel (for tests and development) ───

export class MockSmsChannel implements NotificationChannel {
  readonly channel = 'SMS';

  /** Track sent messages for test assertions */
  readonly sent: NotificationPayload[] = [];

  /** Configurable failure simulation */
  private readonly shouldFail: boolean;

  constructor(options?: { shouldFail?: boolean }) {
    this.shouldFail = options?.shouldFail ?? false;
  }

  async send(payload: NotificationPayload): Promise<ChannelDeliveryResult> {
    this.sent.push(payload);

    if (!payload.userPhone) {
      return {
        success: false,
        error: 'No phone number on user profile',
        permanent: true,
      };
    }

    if (this.shouldFail) {
      logger.debug('Mock SMS channel — simulated failure', {
        notificationId: payload.notificationId,
        to: payload.userPhone,
      });
      return { success: false, error: 'Mock SMS failure', permanent: false };
    }

    logger.debug('Mock SMS channel — would send', {
      notificationId: payload.notificationId,
      to: payload.userPhone,
    });
    return {
      success: true,
      providerId: `mock-sms-${payload.notificationId}`,
    };
  }
}

// ─── Channel registry ───

const channels = new Map<string, NotificationChannel>();

/**
 * Register a notification channel implementation.
 * Called at application startup or in tests.
 */
export function registerChannel(channel: NotificationChannel): void {
  channels.set(channel.channel, channel);
  logger.debug('Notification channel registered', { channel: channel.channel });
}

/**
 * Get a registered channel by name.
 */
export function getChannel(name: string): NotificationChannel | undefined {
  return channels.get(name);
}

/**
 * Get all registered channels.
 */
export function getAllChannels(): NotificationChannel[] {
  return Array.from(channels.values());
}

// ─── Default channel setup ───

/**
 * Initialize default channels for the application.
 * In production, replace mock channels with real providers.
 */
export function initializeDefaultChannels(): void {
  registerChannel(new InAppChannel());
  // Email and SMS channels are NOT registered by default.
  // They must be explicitly configured when a provider is available.
  // In tests, use registerChannel(new MockEmailChannel()) etc.
}

// Auto-initialize on import (safe for server-side only)
if (typeof window === 'undefined') {
  initializeDefaultChannels();
}
