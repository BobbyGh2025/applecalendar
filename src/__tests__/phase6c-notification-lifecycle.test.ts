/**
 * Phase 6C: Notification Lifecycle Tests
 * @vitest-environment node
 *
 * Covers the Phase 6C tasks at the service layer and the actual HTTP
 * route-handler layer (NextRequest + bearer token, same pattern as
 * phase6c-notification-hardening.test.ts from Phase 6B).
 *
 * Coverage:
 *   1.  Registration integration (Task 1)
 *       - POST /api/auth register initializes 15 preference rows
 *       - defaults are consent-safe: IN_APP enabled, EMAIL/SMS disabled
 *       - ensureDefaultPreferences is idempotent and preserves user choices
 *       - duplicate registration does not duplicate preferences
 *   2.  Safe defaults for users WITHOUT preference rows (existing users)
 *       - missing EMAIL/SMS rows are treated as OPTED OUT at dispatch time
 *       - default IN_APP-only dispatch still works
 *   3.  Opt-out enforcement (Task 4)
 *       - disabled EMAIL/SMS channels are never attempted (channel spy)
 *       - disabled IN_APP hides the record (SKIPPED) from list + unread count
 *       - IN_APP off + EMAIL on → delivered via email → record stays visible
 *       - SKIPPED record remains the dedup anchor (retries stay idempotent)
 *   4.  Preferences API ↔ dispatch integration (Task 2/4)
 *       - PUT preference via route controls dispatch behavior
 *       - concurrent PUTs produce exactly one row per type+channel
 *       - GET preferences returns only the authenticated user's rows
 *   5.  Feed + unread-count consistency with SKIPPED records
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';

import {
  dispatchNotification,
  ensureDefaultPreferences,
  getUnreadCount,
  NotificationType,
  DeliveryChannel,
  DeliveryStatus,
} from '@/lib/services/notification-service';

import {
  InAppChannel,
  MockEmailChannel,
  MockSmsChannel,
  registerChannel,
} from '@/lib/services/notification-channels';

import { createSessionAndTokens } from '@/lib/auth';

// Route handlers
import { POST as authRoute } from '@/app/api/auth/route';
import { GET as listNotifications } from '@/app/api/notifications/route';
import { GET as unreadCountRoute } from '@/app/api/notifications/unread-count/route';
import { GET as getPreferencesRoute, PUT as putPreferenceRoute } from '@/app/api/notifications/preferences/route';

// ─── Test helpers ───

function uid(): string {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const createdUserIds: string[] = [];
const createdEmails: string[] = [];

let emailChannel: MockEmailChannel;
let smsChannel: MockSmsChannel;

async function createTestUser() {
  const user = await db.user.create({
    data: {
      email: `p6c-life-${uid()}@test.example`,
      password: 'x',
      name: 'Phase6C Lifecycle User',
      role: 'PUBLIC',
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function authedRequest(
  user: { id: string; email: string; role: string },
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<NextRequest> {
  const { accessToken } = await createSessionAndTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`http://localhost:3000${url}`, {
    method: init?.method ?? 'GET',
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function cleanup() {
  if (createdUserIds.length) {
    // Children first
    await db.refreshToken.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
    await db.emailVerificationToken.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
    await db.auditLog.deleteMany({ where: { actorId: { in: [...createdUserIds] } } });
    await db.notification.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
    await db.notificationPreference.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
    await db.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    createdUserIds.length = 0;
  }
  if (createdEmails.length) {
    // Users created through the register route (tracked by email)
    const routeUsers = await db.user.findMany({
      where: { email: { in: [...createdEmails] } },
      select: { id: true },
    });
    const ids = routeUsers.map((u) => u.id);
    if (ids.length) {
      await db.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await db.emailVerificationToken.deleteMany({ where: { userId: { in: ids } } });
      await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
      await db.notification.deleteMany({ where: { userId: { in: ids } } });
      await db.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
    createdEmails.length = 0;
  }
}

// ─── 1. Registration integration ───

describe('Phase 6C — 1. Registration preference initialization', () => {
  beforeEach(() => {
    registerChannel(new InAppChannel());
    emailChannel = new MockEmailChannel();
    smsChannel = new MockSmsChannel();
    registerChannel(emailChannel);
    registerChannel(smsChannel);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('1a. registering initializes 15 consent-safe preference rows (IN_APP on, EMAIL/SMS off)', async () => {
    const email = `p6c-reg-${uid()}@test.example`;
    createdEmails.push(email);

    const request = new NextRequest('http://localhost:3000/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'register',
        email,
        password: 'Sup3rSecret!',
        name: 'Registration Test',
      }),
    });

    const response = await authRoute(request);
    expect(response.status).toBe(201);

    const registered = await db.user.findUnique({ where: { email } });
    expect(registered).not.toBeNull();
    if (!registered) return;
    createdUserIds.push(registered.id);

    const prefs = await db.notificationPreference.findMany({
      where: { userId: registered.id },
    });
    expect(prefs).toHaveLength(15); // 5 types × 3 channels

    for (const pref of prefs) {
      if (pref.channel === DeliveryChannel.IN_APP) {
        expect(pref.enabled).toBe(true);
      } else {
        // Consent-safe: EMAIL/SMS are OFF until the user opts in
        expect(pref.enabled).toBe(false);
      }
    }

    const types = new Set(prefs.map((p) => p.type));
    expect(types).toEqual(
      new Set([
        NotificationType.BOOKING,
        NotificationType.PAYMENT,
        NotificationType.REFUND,
        NotificationType.EVENT_UPDATE,
        NotificationType.SYSTEM,
      ])
    );
  });

  it('1b. ensureDefaultPreferences is idempotent and preserves user-modified choices', async () => {
    const user = await createTestUser();

    await ensureDefaultPreferences(user.id);
    await ensureDefaultPreferences(user.id); // second run — no duplicates, no overrides

    const prefs = await db.notificationPreference.findMany({
      where: { userId: user.id },
    });
    expect(prefs).toHaveLength(15);

    // User changes BOOKING/EMAIL → true
    await db.notificationPreference.update({
      where: {
        userId_type_channel: {
          userId: user.id,
          type: NotificationType.BOOKING,
          channel: DeliveryChannel.EMAIL,
        },
      },
      data: { enabled: true },
    });

    // Re-run defaults — user choice must survive
    await ensureDefaultPreferences(user.id);
    const bookingEmail = await db.notificationPreference.findUnique({
      where: {
        userId_type_channel: {
          userId: user.id,
          type: NotificationType.BOOKING,
          channel: DeliveryChannel.EMAIL,
        },
      },
    });
    expect(bookingEmail?.enabled).toBe(true);

    const stillFifteen = await db.notificationPreference.count({
      where: { userId: user.id },
    });
    expect(stillFifteen).toBe(15);
  });

  it('1c. duplicate email registration returns 409 and does not duplicate preferences', async () => {
    const email = `p6c-reg2-${uid()}@test.example`;
    createdEmails.push(email);

    const body = {
      action: 'register',
      email,
      password: 'Sup3rSecret!',
      name: 'Registration Test 2',
    };

    const first = await authRoute(
      new NextRequest('http://localhost:3000/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    expect(first.status).toBe(201);

    const registered = await db.user.findUnique({ where: { email } });
    expect(registered).not.toBeNull();
    if (!registered) return;
    createdUserIds.push(registered.id);

    const second = await authRoute(
      new NextRequest('http://localhost:3000/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    expect(second.status).toBe(409);

    const prefCount = await db.notificationPreference.count({
      where: { userId: registered.id },
    });
    expect(prefCount).toBe(15); // exactly one set
  });
});

// ─── 2. Safe defaults for users WITHOUT preference rows ───

describe('Phase 6C — 2. Dispatch fallback for missing preference rows', () => {
  beforeEach(() => {
    registerChannel(new InAppChannel());
    emailChannel = new MockEmailChannel();
    smsChannel = new MockSmsChannel();
    registerChannel(emailChannel);
    registerChannel(smsChannel);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('2a. missing EMAIL/SMS rows are treated as OPTED OUT — channels never attempted', async () => {
    const user = await createTestUser();
    // No preference rows at all (simulates pre-Phase-6C users)

    const result = await dispatchNotification({
      userId: user.id,
      title: 'Payment received',
      message: 'Your payment was successful.',
      type: NotificationType.PAYMENT,
      channels: [DeliveryChannel.IN_APP, DeliveryChannel.EMAIL, DeliveryChannel.SMS],
    });

    // In-app delivered (missing row defaults to enabled)
    expect(result.wasDuplicate).toBe(false);
    const byChannel = Object.fromEntries(
      result.deliveryResults.map((r) => [r.channel, r])
    );
    expect(byChannel[DeliveryChannel.IN_APP]?.success).toBe(true);
    expect(byChannel[DeliveryChannel.EMAIL]?.skipped).toBe(true);
    expect(byChannel[DeliveryChannel.SMS]?.skipped).toBe(true);

    // The critical consent guarantee: mock providers were never invoked
    expect(emailChannel.sent).toHaveLength(0);
    expect(smsChannel.sent).toHaveLength(0);

    const record = await db.notification.findUnique({
      where: { id: result.notificationId },
    });
    expect(record?.deliveryStatus).toBe(DeliveryStatus.SENT);
  });

  it('2b. default IN_APP-only dispatch is unaffected by the fallback change', async () => {
    const user = await createTestUser();

    const result = await dispatchNotification({
      userId: user.id,
      title: 'Booking confirmed',
      message: 'See you at the event!',
      type: NotificationType.BOOKING,
      dedupKey: `booking-default-${uid()}`,
    });

    expect(result.wasDuplicate).toBe(false);
    expect(result.deliveryResults).toHaveLength(1);
    expect(result.deliveryResults[0].channel).toBe(DeliveryChannel.IN_APP);
    expect(result.deliveryResults[0].success).toBe(true);

    const record = await db.notification.findUnique({
      where: { id: result.notificationId },
    });
    expect(record?.deliveryStatus).toBe(DeliveryStatus.SENT);
  });
});

// ─── 3. Opt-out enforcement ───

describe('Phase 6C — 3. Opt-out enforcement', () => {
  beforeEach(() => {
    registerChannel(new InAppChannel());
    emailChannel = new MockEmailChannel();
    smsChannel = new MockSmsChannel();
    registerChannel(emailChannel);
    registerChannel(smsChannel);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('3a. disabled EMAIL preference → email channel never attempted', async () => {
    const user = await createTestUser();
    await db.notificationPreference.create({
      data: {
        userId: user.id,
        type: NotificationType.REFUND,
        channel: DeliveryChannel.EMAIL,
        enabled: false,
      },
    });

    const result = await dispatchNotification({
      userId: user.id,
      title: 'Refund processed',
      message: 'Your refund is on the way.',
      type: NotificationType.REFUND,
      channels: [DeliveryChannel.IN_APP, DeliveryChannel.EMAIL],
    });

    const byChannel = Object.fromEntries(
      result.deliveryResults.map((r) => [r.channel, r])
    );
    expect(byChannel[DeliveryChannel.EMAIL]?.skipped).toBe(true);
    expect(emailChannel.sent).toHaveLength(0);

    const record = await db.notification.findUnique({
      where: { id: result.notificationId },
    });
    expect(record?.deliveryStatus).toBe(DeliveryStatus.SENT); // IN_APP delivered
  });

  it('3b. disabled IN_APP → record SKIPPED, hidden from list route and unread count', async () => {
    const user = await createTestUser();
    await db.notificationPreference.create({
      data: {
        userId: user.id,
        type: NotificationType.SYSTEM,
        channel: DeliveryChannel.IN_APP,
        enabled: false,
      },
    });

    const result = await dispatchNotification({
      userId: user.id,
      title: 'System maintenance',
      message: 'Scheduled maintenance window.',
      type: NotificationType.SYSTEM,
    });

    const record = await db.notification.findUnique({
      where: { id: result.notificationId },
    });
    expect(record?.deliveryStatus).toBe(DeliveryStatus.SKIPPED);

    // List route hides it
    const listResponse = await listNotifications(
      await authedRequest(user, '/api/notifications')
    );
    const listData = (await listResponse.json()) as { notifications: Array<{ id: string }>; unreadCount: number };
    expect(listData.notifications.find((n) => n.id === result.notificationId)).toBeUndefined();

    // Unread-count route hides it
    const unreadResponse = await unreadCountRoute(
      await authedRequest(user, '/api/notifications/unread-count')
    );
    const unreadData = (await unreadResponse.json()) as { count: number };
    expect(unreadData.count).toBe(0);

    // A visible notification coexists correctly
    const visible = await dispatchNotification({
      userId: user.id,
      title: 'Booking confirmed',
      message: 'Visible notification.',
      type: NotificationType.BOOKING,
    });
    const unreadResponse2 = await unreadCountRoute(
      await authedRequest(user, '/api/notifications/unread-count')
    );
    const unreadData2 = (await unreadResponse2.json()) as { count: number };
    expect(unreadData2.count).toBe(1);
    expect(visible.notificationId).not.toBe(result.notificationId);
  });

  it('3c. IN_APP off but EMAIL on → email delivered → record stays visible', async () => {
    const user = await createTestUser();
    await db.notificationPreference.createMany({
      data: [
        {
          userId: user.id,
          type: NotificationType.EVENT_UPDATE,
          channel: DeliveryChannel.IN_APP,
          enabled: false,
        },
        {
          userId: user.id,
          type: NotificationType.EVENT_UPDATE,
          channel: DeliveryChannel.EMAIL,
          enabled: true,
        },
      ],
    });

    const result = await dispatchNotification({
      userId: user.id,
      title: 'Event rescheduled',
      message: 'The event moved to next week.',
      type: NotificationType.EVENT_UPDATE,
      channels: [DeliveryChannel.IN_APP, DeliveryChannel.EMAIL],
    });

    expect(emailChannel.sent).toHaveLength(1);

    const record = await db.notification.findUnique({
      where: { id: result.notificationId },
    });
    expect(record?.deliveryStatus).toBe(DeliveryStatus.SENT); // real delivery happened

    const listResponse = await listNotifications(
      await authedRequest(user, '/api/notifications')
    );
    const listData = (await listResponse.json()) as { notifications: Array<{ id: string }> };
    expect(listData.notifications.find((n) => n.id === result.notificationId)).toBeDefined();
  });

  it('3d. SKIPPED record remains the dedup anchor — retries stay idempotent', async () => {
    const user = await createTestUser();
    await db.notificationPreference.create({
      data: {
        userId: user.id,
        type: NotificationType.PAYMENT,
        channel: DeliveryChannel.IN_APP,
        enabled: false,
      },
    });

    const dedupKey = `payment-skipped-${uid()}`;
    const first = await dispatchNotification({
      userId: user.id,
      title: 'Payment failed',
      message: 'Try another method.',
      type: NotificationType.PAYMENT,
      dedupKey,
    });
    expect(first.wasDuplicate).toBe(false);

    const retry = await dispatchNotification({
      userId: user.id,
      title: 'Payment failed',
      message: 'Try another method.',
      type: NotificationType.PAYMENT,
      dedupKey,
    });
    expect(retry.wasDuplicate).toBe(true);
    expect(retry.notificationId).toBe(first.notificationId);

    const rows = await db.notification.count({ where: { dedupKey } });
    expect(rows).toBe(1);
  });
});

// ─── 4. Preferences API ↔ dispatch integration ───

describe('Phase 6C — 4. Preferences API controls dispatch', () => {
  beforeEach(() => {
    registerChannel(new InAppChannel());
    emailChannel = new MockEmailChannel();
    smsChannel = new MockSmsChannel();
    registerChannel(emailChannel);
    registerChannel(smsChannel);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('4a. PUT preference via route enables EMAIL dispatch for that type', async () => {
    const user = await createTestUser();

    const put = await putPreferenceRoute(
      await authedRequest(user, '/api/notifications/preferences', {
        method: 'PUT',
        body: { type: NotificationType.BOOKING, channel: DeliveryChannel.EMAIL, enabled: true },
      })
    );
    expect(put.status).toBe(200);

    const result = await dispatchNotification({
      userId: user.id,
      title: 'Booking confirmed',
      message: 'Your booking is confirmed.',
      type: NotificationType.BOOKING,
      channels: [DeliveryChannel.IN_APP, DeliveryChannel.EMAIL],
    });

    expect(emailChannel.sent).toHaveLength(1);
    expect(emailChannel.sent[0].userEmail).toBe(user.email);
    expect(result.deliveryResults.find((r) => r.channel === DeliveryChannel.EMAIL)?.skipped).toBeUndefined();
  });

  it('4b. concurrent preference PUTs produce exactly one row per type+channel', async () => {
    const user = await createTestUser();

    const types = [
      NotificationType.BOOKING,
      NotificationType.PAYMENT,
      NotificationType.REFUND,
      NotificationType.EVENT_UPDATE,
      NotificationType.SYSTEM,
    ];

    await Promise.all(
      types.map(async (type, i) =>
        putPreferenceRoute(
          await authedRequest(user, '/api/notifications/preferences', {
            method: 'PUT',
            body: { type, channel: DeliveryChannel.SMS, enabled: i % 2 === 0 },
          })
        )
      )
    );

    const rows = await db.notificationPreference.findMany({
      where: { userId: user.id, channel: DeliveryChannel.SMS },
    });
    expect(rows).toHaveLength(5);
    for (let i = 0; i < types.length; i++) {
      const row = rows.find((r) => r.type === types[i]);
      expect(row?.enabled).toBe(i % 2 === 0);
    }
  });

  it('4c. GET preferences returns only the authenticated user\'s rows', async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    await db.notificationPreference.create({
      data: {
        userId: userB.id,
        type: NotificationType.BOOKING,
        channel: DeliveryChannel.EMAIL,
        enabled: true,
      },
    });

    const response = await getPreferencesRoute(
      await authedRequest(userA, '/api/notifications/preferences')
    );
    const data = (await response.json()) as {
      preferences: Array<{ userId: string }>;
    };
    expect(data.preferences.every((p) => p.userId === userA.id)).toBe(true);
    expect(data.preferences.find((p) => p.userId === userB.id)).toBeUndefined();
  });
});

// ─── 5. Feed + unread-count consistency ───

describe('Phase 6C — 5. Unread consistency with SKIPPED records', () => {
  beforeEach(() => {
    registerChannel(new InAppChannel());
    emailChannel = new MockEmailChannel();
    smsChannel = new MockSmsChannel();
    registerChannel(emailChannel);
    registerChannel(smsChannel);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('5a. service getUnreadCount, list route and unread-count route all exclude SKIPPED', async () => {
    const user = await createTestUser();

    // Two visible unread notifications
    await dispatchNotification({
      userId: user.id,
      title: 'Booking confirmed',
      message: 'Visible one.',
      type: NotificationType.BOOKING,
    });
    await dispatchNotification({
      userId: user.id,
      title: 'Payment received',
      message: 'Visible two.',
      type: NotificationType.PAYMENT,
    });

    // One opted-out (SKIPPED) record
    await db.notificationPreference.create({
      data: {
        userId: user.id,
        type: NotificationType.SYSTEM,
        channel: DeliveryChannel.IN_APP,
        enabled: false,
      },
    });
    await dispatchNotification({
      userId: user.id,
      title: 'System notice',
      message: 'Opted out.',
      type: NotificationType.SYSTEM,
    });

    const serviceCount = await getUnreadCount(user.id);
    expect(serviceCount).toBe(2);

    const unreadResponse = await unreadCountRoute(
      await authedRequest(user, '/api/notifications/unread-count')
    );
    const unreadData = (await unreadResponse.json()) as {
      count: number;
      byType: Record<string, number>;
    };
    expect(unreadData.count).toBe(2);
    expect(unreadData.byType.SYSTEM).toBeUndefined();
    expect(unreadData.byType.BOOKING).toBe(1);
    expect(unreadData.byType.PAYMENT).toBe(1);

    const listResponse = await listNotifications(
      await authedRequest(user, '/api/notifications')
    );
    const listData = (await listResponse.json()) as {
      notifications: Array<{ type: string }>;
      unreadCount: number;
    };
    expect(listData.notifications).toHaveLength(2);
    expect(listData.unreadCount).toBe(2);
    expect(listData.notifications.some((n) => n.type === NotificationType.SYSTEM)).toBe(false);
  });
});
