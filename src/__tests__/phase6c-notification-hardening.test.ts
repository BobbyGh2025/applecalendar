/**
 * Phase 6C: Notification Hardening Tests
 * @vitest-environment node
 *
 * Tests the Phase 6B fixes at BOTH the service layer and the actual
 * HTTP route-handler layer (NextRequest + bearer token pattern from
 * phase5d-infrastructure.test.ts).
 *
 * Coverage:
 *   1.  Event cancellation attendee notifications (fix D1)
 *       - getActiveBookerUserIds: only PENDING/CONFIRMED, distinct
 *       - notifyAttendeesEventCancelled: one notification per booker,
 *         correct fields, dedup on re-run, parallel double-run safe,
 *         never throws on empty input, per-user failure isolation
 *   2.  Route-level authorization
 *       - GET /api/notifications: user A never sees user B's rows
 *       - PATCH /api/notifications/[id]/read: cross-user → 403
 *       - GET /api/notifications/unread-count: scoped
 *       - GET/PUT /api/notifications/preferences: scoped + validation
 *       - Unauthenticated requests → 401
 *   3.  Migration parity (SQLite schema.prisma vs schema.postgresql.prisma)
 *       - Notification + NotificationPreference: field-for-field identical,
 *         including @@unique and @@index definitions
 *   4.  Concurrent unread count consistency under mark-all + new dispatch
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  notifyAttendeesEventCancelled,
  getActiveBookerUserIds,
  getUnreadCount,
  dispatchNotification,
  NotificationType,
  DeliveryChannel,
} from '@/lib/services/notification-service';

import { createSessionAndTokens } from '@/lib/auth';

// Route handlers (imported directly — they are plain async functions)
import { GET as listNotifications, PATCH as markAllReadRoute } from '@/app/api/notifications/route';
import { PATCH as markOneReadRoute } from '@/app/api/notifications/[id]/read/route';
import { GET as unreadCountRoute } from '@/app/api/notifications/unread-count/route';
import { GET as getPreferencesRoute, PUT as putPreferenceRoute } from '@/app/api/notifications/preferences/route';

// ─── Test helpers ───

function uid(): string {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

const createdUserIds: string[] = [];
const createdEventIds: string[] = [];
const createdBookingIds: string[] = [];

async function createTestUser(overrides?: { role?: string }) {
  const user = await db.user.create({
    data: {
      email: `p6c-${uid()}@test.example`,
      password: 'x', // never authenticated via password in these tests
      name: 'Phase6C Test User',
      role: overrides?.role ?? 'PUBLIC',
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createTestEvent(organizerId: string, overrides?: { status?: string; title?: string }) {
  const event = await db.event.create({
    data: {
      title: overrides?.title ?? 'Phase6C Test Event',
      slug: `p6c-${uid()}`,
      description: 'Test event for cancellation notifications',
      startDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      status: overrides?.status ?? 'PUBLISHED',
      organizerId,
    },
  });
  createdEventIds.push(event.id);
  return event;
}

async function createTestBooking(userId: string, eventId: string, status: string) {
  const booking = await db.booking.create({
    data: {
      userId,
      eventId,
      totalAmount: 0,
      status,
      bookingRef: `P6C-${uid()}`,
    },
  });
  createdBookingIds.push(booking.id);
  return booking;
}

/**
 * Build an authenticated NextRequest for the given user.
 * Uses createSessionAndTokens — verifyAccessToken requires the sessionId to
 * reference a real, non-revoked RefreshToken row.
 */
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

function unauthedRequest(url: string, method = 'GET'): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, { method });
}

async function cleanup() {
  // Children first
  if (createdBookingIds.length) {
    await db.booking.deleteMany({ where: { id: { in: [...createdBookingIds] } } });
    createdBookingIds.length = 0;
  }
  // Sessions (RefreshToken rows) created by createSessionAndTokens
  if (createdUserIds.length) {
    await db.refreshToken.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
  }
  // Notifications reference users/events by plain columns (no FK on eventId)
  if (createdUserIds.length) {
    await db.notification.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
    await db.notificationPreference.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
  }
  if (createdEventIds.length) {
    await db.event.deleteMany({ where: { id: { in: [...createdEventIds] } } });
    createdEventIds.length = 0;
  }
  if (createdUserIds.length) {
    await db.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    createdUserIds.length = 0;
  }
}

// ─── 1. Event cancellation attendee notifications ───

describe('Phase 6C — Event cancellation attendee notifications (fix D1)', () => {
  let organizer: Awaited<ReturnType<typeof createTestUser>>;
  let event: Awaited<ReturnType<typeof createTestEvent>>;

  beforeEach(async () => {
    organizer = await createTestUser({ role: 'ORGANIZER' });
    event = await createTestEvent(organizer.id);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it('1a. getActiveBookerUserIds returns DISTINCT userIds of PENDING+CONFIRMED bookers only', async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const carol = await createTestUser();
    const dave = await createTestUser();

    await createTestBooking(alice.id, event.id, 'CONFIRMED');
    await createTestBooking(bob.id, event.id, 'PENDING');
    // Same user, second booking — must NOT duplicate the userId
    await createTestBooking(alice.id, event.id, 'CONFIRMED');
    // Excluded statuses
    await createTestBooking(carol.id, event.id, 'CANCELLED');
    await createTestBooking(dave.id, event.id, 'REFUNDED');

    const bookers = await getActiveBookerUserIds(event.id);

    expect(bookers.sort()).toEqual([alice.id, bob.id].sort());
  });

  it('1b. notifyAttendeesEventCancelled creates one notification per booker with correct fields', async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    const result = await notifyAttendeesEventCancelled({
      eventId: event.id,
      eventTitle: event.title,
      bookerUserIds: [alice.id, bob.id],
    });

    expect(result).toEqual({ notified: 2, failed: 0 });

    for (const userId of [alice.id, bob.id]) {
      const notification = await db.notification.findUnique({
        where: { dedupKey: `event-cancelled-${event.id}-${userId}` },
      });
      expect(notification).not.toBeNull();
      expect(notification!.userId).toBe(userId);
      expect(notification!.type).toBe(NotificationType.EVENT_UPDATE);
      expect(notification!.eventId).toBe(event.id);
      expect(notification!.relatedEntityId).toBe(event.id);
      expect(notification!.relatedEntityType).toBe('Event');
      expect(notification!.link).toBe(`/events/${event.id}`);
      expect(notification!.message).toContain(event.title);
      expect(notification!.deliveryStatus).toBe('SENT'); // InAppChannel succeeds
    }
  });

  it('1c. re-running the cancellation does not duplicate notifications (dedup)', async () => {
    const alice = await createTestUser();

    const first = await notifyAttendeesEventCancelled({
      eventId: event.id,
      eventTitle: event.title,
      bookerUserIds: [alice.id],
    });
    expect(first.notified).toBe(1);

    const second = await notifyAttendeesEventCancelled({
      eventId: event.id,
      eventTitle: event.title,
      bookerUserIds: [alice.id],
    });
    // Second run still counts the dispatch as "notified" but no new row exists
    expect(second.notified).toBe(1);

    const rows = await db.notification.findMany({
      where: { dedupKey: `event-cancelled-${event.id}-${alice.id}` },
    });
    expect(rows).toHaveLength(1);
  });

  it('1d. parallel double-cancellation creates exactly one row per booker (race safety)', async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    const [a, b] = await Promise.all([
      notifyAttendeesEventCancelled({
        eventId: event.id,
        eventTitle: event.title,
        bookerUserIds: [alice.id, bob.id],
      }),
      notifyAttendeesEventCancelled({
        eventId: event.id,
        eventTitle: event.title,
        bookerUserIds: [alice.id, bob.id],
      }),
    ]);

    // Both runs complete without throwing; total rows = 1 per user
    expect(a.notified + b.notified).toBeGreaterThanOrEqual(2);
    expect(a.failed).toBe(0);
    expect(b.failed).toBe(0);

    for (const userId of [alice.id, bob.id]) {
      const rows = await db.notification.findMany({
        where: { dedupKey: `event-cancelled-${event.id}-${userId}` },
      });
      expect(rows).toHaveLength(1);
    }
  });

  it('1e. never throws — even with an empty booker list', async () => {
    const result = await notifyAttendeesEventCancelled({
      eventId: event.id,
      eventTitle: event.title,
      bookerUserIds: [],
    });
    expect(result).toEqual({ notified: 0, failed: 0 });

    const rows = await db.notification.findMany({ where: { eventId: event.id } });
    expect(rows).toHaveLength(0);
  });

  it('1f. per-user failure isolation — one failing dispatch does not abort the loop', async () => {
    const alice = await createTestUser();
    const ghost = 'nonexistent-user-id-that-will-fail'; // userId not in DB → channel "send" is fine, but user lookup fails first
    const bob = await createTestUser();

    const result = await notifyAttendeesEventCancelled({
      eventId: event.id,
      eventTitle: event.title,
      bookerUserIds: [alice.id, ghost, bob.id],
    });

    // Alice and Bob still notified despite ghost failure
    expect(result.notified).toBe(2);
    expect(result.failed).toBe(1);

    const aliceRows = await db.notification.findMany({ where: { userId: alice.id, eventId: event.id } });
    const bobRows = await db.notification.findMany({ where: { userId: bob.id, eventId: event.id } });
    expect(aliceRows).toHaveLength(1);
    expect(bobRows).toHaveLength(1);
  });
});

// ─── 2. Route-level authorization ───

describe('Phase 6C — Notification route authorization', () => {
  let userA: Awaited<ReturnType<typeof createTestUser>>;
  let userB: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
  });

  afterEach(cleanup);

  it('2a. GET /api/notifications returns ONLY the authenticated user\'s notifications', async () => {
    await dispatchNotification({ userId: userA.id, title: 'A1', message: 'A1', type: NotificationType.INFO });
    await dispatchNotification({ userId: userA.id, title: 'A2', message: 'A2', type: NotificationType.INFO });
    await dispatchNotification({ userId: userB.id, title: 'B1', message: 'B1', type: NotificationType.INFO });

    const request = await authedRequest(userA, '/api/notifications');
    const response = await listNotifications(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.notifications).toHaveLength(2);
    for (const n of data.notifications) {
      expect(n.userId).toBe(userA.id);
    }
    expect(data.unreadCount).toBe(2);
  });

  it('2b. unauthenticated GET /api/notifications → 401', async () => {
    const request = unauthedRequest('/api/notifications');
    const response = await listNotifications(request);
    expect(response.status).toBe(401);
  });

  it('2c. PATCH /api/notifications/[id]/read cross-user → 403 and notification stays unread', async () => {
    const notifB = await dispatchNotification({
      userId: userB.id,
      title: 'B private',
      message: 'B private',
      type: NotificationType.INFO,
    });

    // userA tries to mark userB's notification read
    const request = await authedRequest(userA, `/api/notifications/${notifB.notificationId}/read`, { method: 'PATCH' });
    const response = await markOneReadRoute(request, { params: Promise.resolve({ id: notifB.notificationId }) });
    expect(response.status).toBe(403);

    const stillUnread = await db.notification.findUnique({ where: { id: notifB.notificationId } });
    expect(stillUnread!.isRead).toBe(false);
  });

  it('2d. PATCH /api/notifications/[id]/read owner → 200 and marks read', async () => {
    const notif = await dispatchNotification({
      userId: userA.id,
      title: 'Mine',
      message: 'Mine',
      type: NotificationType.INFO,
    });

    const request = await authedRequest(userA, `/api/notifications/${notif.notificationId}/read`, { method: 'PATCH' });
    const response = await markOneReadRoute(request, { params: Promise.resolve({ id: notif.notificationId }) });
    expect(response.status).toBe(200);

    const read = await db.notification.findUnique({ where: { id: notif.notificationId } });
    expect(read!.isRead).toBe(true);
  });

  it('2e. GET /api/notifications/unread-count is scoped per user', async () => {
    await dispatchNotification({ userId: userA.id, title: 'A1', message: 'A1', type: NotificationType.BOOKING });
    await dispatchNotification({ userId: userA.id, title: 'A2', message: 'A2', type: NotificationType.PAYMENT });
    await dispatchNotification({ userId: userB.id, title: 'B1', message: 'B1', type: NotificationType.INFO });

    const requestA = await authedRequest(userA, '/api/notifications/unread-count');
    const responseA = await unreadCountRoute(requestA);
    const dataA = await responseA.json();
    expect(dataA.count).toBe(2);
    expect(dataA.byType.BOOKING).toBe(1);
    expect(dataA.byType.PAYMENT).toBe(1);
    expect(dataA.byType.INFO).toBeUndefined();

    const requestB = await authedRequest(userB, '/api/notifications/unread-count');
    const responseB = await unreadCountRoute(requestB);
    const dataB = await responseB.json();
    expect(dataB.count).toBe(1);
    expect(dataB.byType.INFO).toBe(1);
  });

  it('2f. PATCH /api/notifications (mark-all-read) only touches the authenticated user', async () => {
    await dispatchNotification({ userId: userA.id, title: 'A1', message: 'A1', type: NotificationType.INFO });
    await dispatchNotification({ userId: userB.id, title: 'B1', message: 'B1', type: NotificationType.INFO });

    const request = await authedRequest(userA, '/api/notifications', { method: 'PATCH' });
    const response = await markAllReadRoute(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.markedRead).toBe(1);

    // userB's notification untouched
    expect(await getUnreadCount(userB.id)).toBe(1);
    expect(await getUnreadCount(userA.id)).toBe(0);
  });

  it('2g. PUT /api/notifications/preferences — creates preference for authenticated user', async () => {
    const request = await authedRequest(userA, '/api/notifications/preferences', {
      method: 'PUT',
      body: { type: NotificationType.PAYMENT, channel: DeliveryChannel.EMAIL, enabled: false },
    });

    const response = await putPreferenceRoute(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.preference.userId).toBe(userA.id);
    expect(data.preference.enabled).toBe(false);

    // userB has no preferences
    const bPrefs = await db.notificationPreference.findMany({ where: { userId: userB.id } });
    expect(bPrefs).toHaveLength(0);
  });

  it('2h. PUT /api/notifications/preferences — invalid type → 400', async () => {
    const request = await authedRequest(userA, '/api/notifications/preferences', {
      method: 'PUT',
      body: { type: 'NOT_A_REAL_TYPE', channel: DeliveryChannel.EMAIL, enabled: true },
    });

    const response = await putPreferenceRoute(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('2i. PUT /api/notifications/preferences — invalid channel → 400', async () => {
    const request = await authedRequest(userA, '/api/notifications/preferences', {
      method: 'PUT',
      body: { type: NotificationType.BOOKING, channel: 'CARRIER_PIGEON', enabled: true },
    });

    const response = await putPreferenceRoute(request);
    expect(response.status).toBe(400);
  });

  it('2j. unauthenticated preferences access → 401', async () => {
    const getResponse = await getPreferencesRoute(unauthedRequest('/api/notifications/preferences'));
    expect(getResponse.status).toBe(401);

    const putResponse = await putPreferenceRoute(
      unauthedRequest('/api/notifications/preferences', 'PUT')
    );
    expect(putResponse.status).toBe(401);
  });

  it('2k. GET /api/notifications/preferences — empty list means defaults', async () => {
    const request = await authedRequest(userA, '/api/notifications/preferences');
    const response = await getPreferencesRoute(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.preferences).toEqual([]);
    expect(data.defaults.note).toContain('IN_APP enabled');
  });

  it('2l. unread count stays consistent when mark-all races with a new dispatch', async () => {
    await dispatchNotification({ userId: userA.id, title: 'A1', message: 'A1', type: NotificationType.INFO });
    await dispatchNotification({ userId: userA.id, title: 'A2', message: 'A2', type: NotificationType.INFO });

    // Race: mark-all-read runs concurrently with a new notification dispatch
    const [, ] = await Promise.all([
      markAllReadRoute(await authedRequest(userA, '/api/notifications', { method: 'PATCH' })),
      dispatchNotification({ userId: userA.id, title: 'A3', message: 'A3', type: NotificationType.INFO }),
    ]);

    const unread = await getUnreadCount(userA.id);
    // The new notification either got marked read by the racing PATCH or remains unread —
    // but the count must always be an accurate reflection of the DB state.
    const actualUnreadRows = await db.notification.count({ where: { userId: userA.id, isRead: false } });
    expect(unread).toBe(actualUnreadRows);
    expect([0, 1]).toContain(unread);
  });
});

// ─── 3. Migration parity ───

describe('Phase 6C — Migration parity (SQLite vs PostgreSQL schemas)', () => {
  function extractModel(schemaText: string, modelName: string): string {
    const regex = new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`);
    const match = schemaText.match(regex);
    if (!match) throw new Error(`Model ${modelName} not found`);
    return match[1];
  }

  function extractFields(modelBody: string): Map<string, string> {
    const fields = new Map<string, string>();
    for (const line of modelBody.split('\n')) {
      const trimmed = line.trim();
      // Field lines: "name Type modifiers" — skip attributes blocks (@@), relations are compared too
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
      const match = trimmed.match(/^(\w+)\s+(\w+.*?)\s*(\/\/.*)?$/);
      if (match) {
        // Normalize whitespace in the type expression
        fields.set(match[1], match[2].replace(/\s+/g, ' ').trim());
      }
    }
    return fields;
  }

  function extractModelAttributes(modelBody: string): string[] {
    const attrs: string[] = [];
    for (const line of modelBody.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('@@')) {
        // Normalize: strip trailing comments, collapse whitespace
        attrs.push(trimmed.replace(/\s*\/\/.*$/, '').replace(/\s+/g, ' '));
      }
    }
    return attrs.sort();
  }

  function compareModels(modelName: string) {
    const sqliteSchema = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'),
      'utf-8',
    );
    const pgSchema = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.postgresql.prisma'),
      'utf-8',
    );

    const sqliteBody = extractModel(sqliteSchema, modelName);
    const pgBody = extractModel(pgSchema, modelName);

    const sqliteFields = extractFields(sqliteBody);
    const pgFields = extractFields(pgBody);

    // Same field set
    const sqliteFieldNames = [...sqliteFields.keys()].sort();
    const pgFieldNames = [...pgFields.keys()].sort();
    expect(sqliteFieldNames).toEqual(pgFieldNames);

    // Same type expression per field (nullable ? markers included)
    for (const [name, type] of sqliteFields) {
      expect(pgFields.get(name)).toBe(type);
    }

    // Same model-level attributes (@@unique, @@index, @@map)
    expect(extractModelAttributes(sqliteBody)).toEqual(extractModelAttributes(pgBody));
  }

  it('3a. Notification model is identical in both schemas', () => {
    compareModels('Notification');
  });

  it('3b. NotificationPreference model is identical in both schemas', () => {
    compareModels('NotificationPreference');
  });

  it('3c. migration SQL is provider-agnostic (no SQLite-only or PG-only syntax)', () => {
    const migrationPath = path.join(
      __dirname,
      '../../prisma/migrations/3_phase6_notification_delivery/migration.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Provider-specific constructs that would break one target
    expect(sql).not.toMatch(/\bAUTOINCREMENT\b/); // SQLite-only
    expect(sql).not.toMatch(/\bSERIAL\b/i); // PG-only
    expect(sql).not.toMatch(/::\w+/); // PG casts
    expect(sql).not.toMatch(/\bSTRAIGHT_JOIN\b/i);

    // Both providers support the constructs actually used
    expect(sql).toMatch(/CREATE UNIQUE INDEX "Notification_dedupKey_key"[\s\S]*WHERE "dedupKey" IS NOT NULL/);
    expect(sql).toMatch(/CREATE TABLE "NotificationPreference"/);
    expect(sql).toMatch(/ON DELETE CASCADE/);
  });

  it('3d. dedupKey unique index is partial (NULLs excluded) in migration SQL', () => {
    const migrationPath = path.join(
      __dirname,
      '../../prisma/migrations/3_phase6_notification_delivery/migration.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    // Partial index ensures legacy rows and no-key dispatches (dedupKey NULL)
    // never collide — required for correct dedup semantics
    expect(sql).toMatch(/WHERE "dedupKey" IS NOT NULL/);
  });
});
