/**
 * Phase 6: Notification Service
 *
 * Centralized service for creating and dispatching notifications.
 * Replaces the 8 inline `db.notification.create()` call sites with
 * a single, well-tested service that handles:
 *
 *   1. Dedup — same dedupKey → no duplicate notification
 *   2. Preference checking — user may opt out of specific type+channel
 *   3. Multi-channel dispatch — IN_APP (always), EMAIL/SMS (if configured + preferred)
 *   4. Delivery status tracking — PENDING → SENT/FAILED/DELIVERED
 *   5. Safe error handling — notification failure NEVER rolls back the primary transaction
 *
 * Usage:
 *   await dispatchNotification({
 *     userId, title, message, type,
 *     eventId, relatedEntityId, relatedEntityType,
 *     dedupKey: `payment-success-${paymentId}`,
 *   });
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  getChannel,
  type NotificationPayload,
  type ChannelDeliveryResult,
} from './notification-channels';

// ─── Notification type constants ───

export const NotificationType = {
  INFO: 'INFO',
  BOOKING: 'BOOKING',
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
  EVENT_UPDATE: 'EVENT_UPDATE',
  SYSTEM: 'SYSTEM',
} as const;

export type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];

export const DeliveryChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
} as const;

export const DeliveryStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;

// ─── Dispatch params ───

export interface DispatchNotificationParams {
  userId: string;
  title: string;
  message: string;
  type: NotificationTypeValue;
  /** Deep link to the relevant entity */
  link?: string;
  /** Event ID — fixes the UI bug where component references n.eventId */
  eventId?: string;
  /** Polymorphic reference to the entity that triggered this notification */
  relatedEntityId?: string;
  relatedEntityType?: 'Booking' | 'Payment' | 'Refund' | 'Event' | 'Organizer';
  /**
   * Dedup key — if a notification with this key already exists,
   * the dispatch is skipped (idempotent).
   * Format: "{event}-{entityId}" e.g. "payment-success-cm123"
   */
  dedupKey?: string;
  /** Which channels to attempt (default: IN_APP only) */
  channels?: string[];
}

// ─── Dispatch result ───

export interface DispatchResult {
  notificationId: string;
  wasDuplicate: boolean;
  deliveryResults: Array<{
    channel: string;
    success: boolean;
    error?: string;
  }>;
}

// ─── Core: dispatch notification ───

/**
 * Create a notification record and dispatch it through configured channels.
 *
 * IMPORTANT: This function is designed to be called AFTER the primary
 * business transaction commits. If it fails, the primary operation is
 * NOT rolled back. Callers should wrap in try/catch.
 *
 * Dedup: If `dedupKey` is provided and a notification with that key
 * already exists, returns immediately with wasDuplicate=true.
 *
 * Preference: If the user has disabled this type+channel combination,
 * that channel is SKIPPED (not sent, but no error).
 */
export async function dispatchNotification(
  params: DispatchNotificationParams,
): Promise<DispatchResult> {
  const {
    userId,
    title,
    message,
    type,
    link,
    eventId,
    relatedEntityId,
    relatedEntityType,
    dedupKey,
    channels: requestedChannels,
  } = params;

  // 1. Dedup check — if dedupKey exists, skip
  if (dedupKey) {
    const existing = await db.notification.findUnique({
      where: { dedupKey },
      select: { id: true },
    });
    if (existing) {
      logger.debug('Notification dedup — skipping duplicate', { dedupKey });
      return {
        notificationId: existing.id,
        wasDuplicate: true,
        deliveryResults: [],
      };
    }
  }

  // 2. Create the in-app notification record
  const notification = await db.notification.create({
    data: {
      userId,
      title,
      message,
      type,
      link,
      eventId,
      relatedEntityId,
      relatedEntityType,
      dedupKey,
      deliveryChannel: DeliveryChannel.IN_APP,
      deliveryStatus: DeliveryStatus.PENDING,
    },
  });

  // 3. Dispatch through channels
  const channelsToUse = requestedChannels ?? [DeliveryChannel.IN_APP];
  const deliveryResults: DispatchResult['deliveryResults'] = [];

  for (const channelName of channelsToUse) {
    // 3a. Check user preference for this type+channel
    const preference = await db.notificationPreference.findUnique({
      where: {
        userId_type_channel: { userId, type, channel: channelName },
      },
      select: { enabled: true },
    });

    // If preference exists and is disabled, skip this channel
    // If no preference exists, default to enabled (opt-in not required for existing users)
    if (preference !== null && !preference.enabled) {
      logger.debug('Notification skipped — user preference disabled', {
        userId,
        type,
        channel: channelName,
      });

      // For IN_APP, still mark as SENT (the record exists = delivered)
      if (channelName === DeliveryChannel.IN_APP) {
        await db.notification.update({
          where: { id: notification.id },
          data: {
            deliveryStatus: DeliveryStatus.SENT,
            deliveredAt: new Date(),
          },
        });
        deliveryResults.push({ channel: channelName, success: true });
      } else {
        deliveryResults.push({ channel: channelName, success: true });
      }
      continue;
    }

    // 3b. Get the channel implementation
    const channel = getChannel(channelName);
    if (!channel) {
      logger.debug('Notification channel not registered — skipping', {
        channel: channelName,
      });
      deliveryResults.push({
        channel: channelName,
        success: false,
        error: 'Channel not registered',
      });
      continue;
    }

    // 3c. Build the payload
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, phone: true },
    });

    if (!user) {
      logger.warn('Cannot dispatch notification — user not found', { userId });
      deliveryResults.push({
        channel: channelName,
        success: false,
        error: 'User not found',
      });
      continue;
    }

    const payload: NotificationPayload = {
      notificationId: notification.id,
      userId,
      userEmail: user.email,
      userName: user.name,
      userPhone: user.phone ?? undefined,
      title,
      message,
      type,
      link,
      eventId,
      relatedEntityId,
      relatedEntityType,
    };

    // 3d. Attempt delivery
    try {
      const result: ChannelDeliveryResult = await channel.send(payload);

      if (result.success) {
        // Update delivery status
        await db.notification.update({
          where: { id: notification.id },
          data: {
            deliveryStatus: DeliveryStatus.SENT,
            deliveredAt: new Date(),
          },
        });
        deliveryResults.push({ channel: channelName, success: true });
      } else {
        // Delivery failed — update status
        const isPermanent = result.permanent ?? false;
        await db.notification.update({
          where: { id: notification.id },
          data: {
            deliveryStatus: isPermanent ? DeliveryStatus.FAILED : DeliveryStatus.PENDING,
            failedAt: isPermanent ? new Date() : null,
          },
        });
        deliveryResults.push({
          channel: channelName,
          success: false,
          error: result.error,
        });
      }
    } catch (channelError) {
      // Channel threw unexpectedly — treat as non-permanent failure
      logger.error('Notification channel threw unexpected error', {
        channel: channelName,
        notificationId: notification.id,
        error: channelError instanceof Error ? channelError.message : 'unknown',
      });
      deliveryResults.push({
        channel: channelName,
        success: false,
        error: 'Channel threw unexpected error',
      });
    }
  }

  return {
    notificationId: notification.id,
    wasDuplicate: false,
    deliveryResults,
  };
}

// ─── Convenience: dispatch to multiple channels ───

/**
 * Dispatch a notification through IN_APP + EMAIL channels.
 * Used for important notifications that warrant email delivery.
 */
export async function dispatchWithEmail(
  params: Omit<DispatchNotificationParams, 'channels'>,
): Promise<DispatchResult> {
  return dispatchNotification({
    ...params,
    channels: [DeliveryChannel.IN_APP, DeliveryChannel.EMAIL],
  });
}

/**
 * Dispatch a notification through IN_APP + SMS channels.
 * Used for time-critical notifications (e.g., event starting soon).
 */
export async function dispatchWithSms(
  params: Omit<DispatchNotificationParams, 'channels'>,
): Promise<DispatchResult> {
  return dispatchNotification({
    ...params,
    channels: [DeliveryChannel.IN_APP, DeliveryChannel.SMS],
  });
}

// ─── Mark as read ───

export async function markNotificationRead(notificationId: string): Promise<void> {
  await db.notification.update({
    where: { id: notificationId },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, isRead: false },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
  return result.count;
}

// ─── Unread count ───

export async function getUnreadCount(userId: string): Promise<number> {
  return db.notification.count({
    where: { userId, isRead: false },
  });
}

// ─── Preference management ───

export async function getNotificationPreferences(userId: string) {
  return db.notificationPreference.findMany({
    where: { userId },
    orderBy: [{ type: 'asc' }, { channel: 'asc' }],
  });
}

export async function setNotificationPreference(
  userId: string,
  type: string,
  channel: string,
  enabled: boolean,
) {
  return db.notificationPreference.upsert({
    where: { userId_type_channel: { userId, type, channel } },
    update: { enabled },
    create: { userId, type, channel, enabled },
  });
}

/**
 * Ensure a user has default notification preferences.
 * Called on user creation or on first preference access.
 */
export async function ensureDefaultPreferences(userId: string): Promise<void> {
  const types = [
    NotificationType.BOOKING,
    NotificationType.PAYMENT,
    NotificationType.REFUND,
    NotificationType.EVENT_UPDATE,
    NotificationType.SYSTEM,
  ];
  const channels = [DeliveryChannel.IN_APP, DeliveryChannel.EMAIL, DeliveryChannel.SMS];

  for (const type of types) {
    for (const channel of channels) {
      await db.notificationPreference.upsert({
        where: { userId_type_channel: { userId, type, channel } },
        update: {},
        create: {
          userId,
          type,
          channel,
          enabled: channel === DeliveryChannel.IN_APP, // IN_APP on by default; EMAIL/SMS off until user opts in
        },
      });
    }
  }
}
