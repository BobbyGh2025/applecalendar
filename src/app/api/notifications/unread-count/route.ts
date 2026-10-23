import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

/**
 * GET /api/notifications/unread-count — Get unread notification count
 *
 * Lightweight endpoint for badge/header indicators.
 * Returns: { count, byType: { BOOKING: n, PAYMENT: n, ... } }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const count = await db.notification.count({
      where: { userId: user.id, isRead: false },
    });

    // Breakdown by type
    const byType = await db.notification.groupBy({
      by: ['type'],
      where: { userId: user.id, isRead: false },
      _count: { type: true },
    });

    const byTypeMap: Record<string, number> = {};
    for (const group of byType) {
      byTypeMap[group.type] = group._count.type;
    }

    return NextResponse.json({ count, byType: byTypeMap });
  } catch (error) {
    return handleApiError(error);
  }
}
