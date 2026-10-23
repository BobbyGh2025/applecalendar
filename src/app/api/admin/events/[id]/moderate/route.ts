import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { z } from 'zod';
import { dispatchNotification, NotificationType } from '@/lib/services/notification-service';
import { logger } from '@/lib/logger';

const VALID_ACTIONS = ['approve', 'reject'] as const;

const moderateEventSchema = z.object({
  action: z.enum(VALID_ACTIONS),
  reason: z.string().max(1000).optional(),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const event = await db.event.findUnique({ where: { id } });
    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    const body = await request.json();
    const parsed = moderateEventSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { action, reason } = parsed.data;
    const newStatus = action === 'approve' ? 'PUBLISHED' : 'CANCELLED';
    const previousStatus = event.status;

    // Phase 4H: Use a transaction for atomic event update + audit log
    const [updatedEvent] = await db.$transaction([
      db.event.update({
        where: { id },
        data: { status: newStatus },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          organizer: { select: { id: true, name: true, email: true } },
        },
      }),
      db.auditLog.create({
        data: {
          actorId: user.id,
          action: action === 'approve' ? 'APPROVE' : 'REJECT',
          entityType: 'Event',
          entityId: id,
          oldValue: JSON.stringify({ status: previousStatus }),
          newValue: JSON.stringify({ status: newStatus }),
          reason: reason ?? null,
        },
      }),
    ]);

    // Notify the organizer — notification failure does not break the action
    try {
      await dispatchNotification({
        userId: event.organizerId,
        title: action === 'approve' ? 'Event Approved' : 'Event Rejected',
        message: `Your event "${event.title}" has been ${action === 'approve' ? 'approved and published' : 'rejected'}.${reason ? ` Reason: ${reason}` : ''}`,
        type: NotificationType.EVENT_UPDATE,
        eventId: id,
        relatedEntityId: id,
        relatedEntityType: 'Event',
        dedupKey: `event-${action}-${id}`,
        link: `/events/${id}`,
      });
    } catch (notificationError) {
      logger.error('Failed to send event moderation notification', {
        eventId: id,
        action,
        error: notificationError instanceof Error ? notificationError.message : 'unknown',
      });
    }

    return NextResponse.json({
      event: updatedEvent,
      message: `Event ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
