import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    const url = new URL(request.url);

    // Parse query parameters
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
    const type = url.searchParams.get('type') ?? undefined;
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100);

    // Build where clause
    const where: Record<string, unknown> = { userId: user.id };
    if (unreadOnly) where.isRead = false;
    if (type) where.type = type;

    // Cursor-based pagination
    if (cursor) {
      where.id = { lt: cursor }; // Older notifications have lower curs
    }

    const notifications = await db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Fetch one extra to check if there are more
    });

    const hasMore = notifications.length > limit;
    const items = hasMore ? notifications.slice(0, limit) : notifications;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    // Get unread count
    const unreadCount = await db.notification.count({
      where: { userId: user.id, isRead: false },
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
      where: { userId: user.id, isRead: false },
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
