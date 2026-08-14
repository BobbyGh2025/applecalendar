import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id } = await params;

    const notification = await db.notification.findUnique({ where: { id } });
    if (!notification) {
      throw new ApiError(404, 'NOT_FOUND', 'Notification not found');
    }

    if (notification.userId !== user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to update this notification');
    }

    const updatedNotification = await db.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return NextResponse.json({ notification: updatedNotification });
  } catch (error) {
    return handleApiError(error);
  }
}
