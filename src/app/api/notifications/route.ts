import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    const url = new URL(request.url);

    // Parse query parameters
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
    const type = url.searchParams.get('type') ?? undefined;
    const cursor = url.searchParams.get('cursor') ?? undefined;
    // Phase 6D (N-9): guard NaN from non-numeric limit — parseInt('abc') === NaN
    // previously produced take: NaN and a Prisma 500.
    const parsedLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 100);

    // Build where clause
    // Phase 6C: records the user opted out of (deliveryStatus SKIPPED) are
    // kept only as dedup anchors — they never appear in the feed.
    const where: Record<string, unknown> = {
      userId: user.id,
      deliveryStatus: { not: 'SKIPPED' },
    };
    if (unreadOnly) where.isRead = false;
    if (type) where.type = type;

    // Phase 6D (N-8): order-consistent cursor pagination.
    //
    // The previous implementation filtered with `id: { lt: cursor }` while
    // sorting by `createdAt desc`. Notification ids are cuids — lexicographic
    // id order only approximates creation order and diverges under clock skew
    // or same-millisecond inserts (exactly the mass-cancellation burst this
    // feed is built for), so pages could skip or duplicate rows.
    //
    // The cursor is now a composite `createdAt:id` pair and the query sorts by
    // (createdAt desc, id desc) with a tuple where-clause — rows can neither
    // be skipped nor re-served regardless of insertion timing.
    let cursorFilter: Prisma.NotificationWhereInput | undefined;
    let decodedCursor: { createdAt: Date; id: string } | undefined;
    if (cursor) {
      const separatorIndex = cursor.lastIndexOf('_');
      if (separatorIndex > 0) {
        const createdAtMs = Number(cursor.slice(0, separatorIndex));
        const cursorId = cursor.slice(separatorIndex + 1);
        if (Number.isFinite(createdAtMs) && cursorId) {
          decodedCursor = { createdAt: new Date(createdAtMs), id: cursorId };
          cursorFilter = {
            OR: [
              { createdAt: { lt: decodedCursor.createdAt } },
              {
                createdAt: decodedCursor.createdAt,
                id: { lt: decodedCursor.id },
              },
            ],
          };
        }
      }
      // Malformed cursor → treated as absent (first page) rather than a 500.
    }

    const notifications = await db.notification.findMany({
      where: cursorFilter ? { AND: [where, cursorFilter] } : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // Fetch one extra to check if there are more
    });

    const hasMore = notifications.length > limit;
    const items = hasMore ? notifications.slice(0, limit) : notifications;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? `${last.createdAt.getTime()}_${last.id}` : null;

    // Get unread count (SKIPPED records excluded — Phase 6C)
    const unreadCount = await db.notification.count({
      where: {
        userId: user.id,
        isRead: false,
        deliveryStatus: { not: 'SKIPPED' },
      },
    });

    return NextResponse.json({
      notifications: items,
      unreadCount,
      hasMore,
      nextCursor,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/notifications — Mark all notifications as read
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const result = await db.notification.updateMany({
      // Phase 6D (N-11): SKIPPED dedup-anchor rows stay untouched, consistent
      // with the feed/unread-count invariants from Phase 6C.
      where: { userId: user.id, isRead: false, deliveryStatus: { not: 'SKIPPED' } },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return NextResponse.json({
      markedRead: result.count,
      message: `${result.count} notifications marked as read`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
