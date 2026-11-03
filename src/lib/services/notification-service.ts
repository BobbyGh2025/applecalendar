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
    /** True when the channel was NOT attempted because the user opted out */
    skipped?: boolean;
  }>;
}

/**
 * Phase 6C: default enablement when a user has NO preference row for a
 * type+channel combination. Aligned with ensureDefaultPreferences():
 *
 *   - IN_APP  → enabled (the in-app feed is the base experience)
 *   - EMAIL   → DISABLED (no consent = no email)
 *   - SMS     → DISABLED (no consent = no SMS)
 *
 * Before Phase 6C a missing row was treated as enabled for EVERY channel,
 * meaning existing users with no preference rows were implicitly opted in
 * to EMAIL/SMS. Safe while no call site requested those channels, but a
 * latent consent violation — now fixed so the fallback matches the
 * registration-time defaults exactly.
 */
const DEFAULT_CHANNEL_ENABLED: Record<string, boolean> = {
  [DeliveryChannel.IN_APP]: true,
  [DeliveryChannel.EMAIL]: false,
  [DeliveryChannel.SMS]: false,
};

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
  //    Two-phase: findUnique first (fast path), then handle P2002 on create (race path).
  //    This avoids TOCTOU: if two concurrent requests pass findUnique, the @@unique([dedupKey])
  //    constraint causes one create to fail with P2002 — we catch it and return wasDuplicate.
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

  // 2. Create the in-app notification record (may race on dedupKey unique constraint)
  let notification;
  try {
    notification = await db.notification.create({
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
  } catch (createError) {
    // Handle concurrent dedup: another process created a notification with the same
    // dedupKey between our findUnique and this create (P2002 = unique constraint violation).
    if (dedupKey && isPrismaUniqueConstraintViolation(createError)) {
      const existing = await db.notification.findUnique({
        where: { dedupKey },
        select: { id: true },
      });
      if (existing) {
        logger.debug('Notification dedup — concurrent create detected, returning existing', { dedupKey });
        return {
          notificationId: existing.id,
          wasDuplicate: true,
          deliveryResults: [],
        };
      }
    }
    // Not a dedup race — re-throw
    throw createError;
  }

  // 3. Dispatch through channels
  const channelsToUse = requestedChannels ?? [DeliveryChannel.IN_APP];
  const deliveryResults: DispatchResult['deliveryResults'] = [];

  // Phase 6C opt-out tracking:
  //   - inAppOptedOut: the user explicitly disabled IN_APP for this type.
  //     The record is kept (dedup anchor) but marked SKIPPED so it does not
  //     appear in the feed — enforced preference, not just metadata.
  //   - anyChannelDelivered: if ANY requested channel actually delivered,
  //     the record stays visible (e.g. user disabled IN_APP but enabled
  //     EMAIL and the email was sent — the record reflects real delivery).
  let inAppOptedOut = false;
  let anyChannelDelivered = false;

  for (const channelName of channelsToUse) {
    // 3a. Check user preference for this type+channel.
    // Missing row → DEFAULT_CHANNEL_ENABLED (IN_APP on, EMAIL/SMS off).
    const preference = await db.notificationPreference.findUnique({
      where: {
        userId_type_channel: { userId, type, channel: channelName },
      },
      select: { enabled: true },
    });

    const preferenceEnabled =
      preference !== null
        ? preference.enabled
        : DEFAULT_CHANNEL_ENABLED[channelName] ?? true;

    // User opted out of this type+channel — channel is NOT attempted.
    if (!preferenceEnabled) {
      logger.debug('Notification skipped — user preference disabled', {
        userId,
        type,
        channel: channelName,
        source: preference !== null ? 'preference_row' : 'safe_default',
      });

      if (channelName === DeliveryChannel.IN_APP) {
        inAppOptedOut = true;
      }
      deliveryResults.push({ channel: channelName, success: true, skipped: true });
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
        anyChannelDelivered = true;
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

  // Phase 6C: if the user opted out of IN_APP and no other channel
  // delivered, mark the record SKIPPED. The row remains as the dedup
  // anchor (retries stay idempotent) but is excluded from the feed and
  // unread counts by the list/unread-count routes.
  if (inAppOptedOut && !anyChannelDelivered) {
    await db.notification.update({
      where: { id: notification.id },
      data: { deliveryStatus: DeliveryStatus.SKIPPED },
    });
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

// ─── Event cancellation attendee notifications (Phase 6B) ───

/**
 * Notify all active bookers that an event was cancelled.
 *
 * Phase 6B fix D1: PATCH /api/events/[id] (PUBLISHED → CANCELLED) and the
 * DELETE soft-delete path previously cancelled events silently — paying
 * ticketholders were never told.
 *
 * Design:
 *   - Caller resolves DISTINCT booker userIds for ACTIVE bookings
 *     (status PENDING or CONFIRMED) — cancelled/refunded bookers excluded.
 *   - dedupKey "event-cancelled-{eventId}-{userId}" makes retries and
 *     re-cancellation attempts idempotent per user.
 *   - Per-user try/catch: one failed dispatch never aborts the loop.
 *   - This function NEVER throws — safe to call fire-and-forget after the
 *     event state transition has committed.
 */
export async function notifyAttendeesEventCancelled(params: {
  eventId: string;
  eventTitle: string;
  bookerUserIds: string[];
}): Promise<{ notified: number; failed: number }> {
  const { eventId, eventTitle, bookerUserIds } = params;
  let notified = 0;
  let failed = 0;

  // Phase 6D (N-14): bounded-concurrency fan-out. The previous sequential
  // loop awaited each dispatch (≈5 DB round-trips per booker) inside the
  // event PATCH — a 1,000-booker event meant ~5,000 serial queries (10-30s)
  // and gateway timeouts. Chunks of 50 keep DB pool pressure bounded while
  // cutting wall-clock time ~20x. Per-user semantics are unchanged: same
  // dispatchNotification call, per-user dedupKey, per-user error isolation.
  const FAN_OUT_CHUNK_SIZE = 50;

  for (let i = 0; i < bookerUserIds.length; i += FAN_OUT_CHUNK_SIZE) {
    const chunk = bookerUserIds.slice(i, i + FAN_OUT_CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (userId) => {
        try {
          await dispatchNotification({
            userId,
            title: 'Event Cancelled',
            message: `The event "${eventTitle}" has been cancelled by the organizer. If you purchased tickets, you will be contacted regarding refunds.`,
            type: NotificationType.EVENT_UPDATE,
            eventId,
            relatedEntityId: eventId,
            relatedEntityType: 'Event',
            dedupKey: `event-cancelled-${eventId}-${userId}`,
            link: `/events/${eventId}`,
          });
          return true;
        } catch (error) {
          logger.error('Failed to dispatch event cancellation notification', {
            eventId,
            userId,
            error: error instanceof Error ? error.message : 'unknown',
          });
          return false;
        }
      })
    );
    for (const ok of results) {
      if (ok) notified++;
      else failed++;
    }
  }

  return { notified, failed };
}

/**
 * Resolve the DISTINCT userIds of all active bookers (PENDING or CONFIRMED)
 * for an event. Used by event cancellation flows so cancelled/refunded
 * bookers are not re-notified.
 */
export async function getActiveBookerUserIds(eventId: string): Promise<string[]> {
  const bookings = await db.booking.findMany({
    where: { eventId, status: { in: ['PENDING', 'CONFIRMED'] } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return bookings.map((b) => b.userId);
}

// ─── Mark as read ───

/**
 * Mark a notification as read — OWNERSHIP ENFORCED.
 *
 * Phase 6B fix D2: previously updated by id alone with no userId scoping.
 * The update is now scoped to { id, userId }; if the notification does not
 * exist OR belongs to another user, count=0 and an error is thrown so the
 * caller can map it to 404/403. Cross-user mutation is impossible.
 */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  const result = await db.notification.updateMany({
    where: { id: notificationId, userId },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
  if (result.count === 0) {
    throw new Error(
      `Notification ${notificationId} not found for user ${userId}`,
    );
  }
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
    where: {
      userId,
      isRead: false,
      // Phase 6C: records the user opted out of (SKIPPED) are never counted
      deliveryStatus: { not: DeliveryStatus.SKIPPED },
    },
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

// ─── Helper: Prisma Unique Constraint Violation Detection ───

/**
 * Detect Prisma P2002 error (unique constraint violation).
 * Used to handle concurrent notification dispatches that race on dedupKey.
 */
function isPrismaUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}
