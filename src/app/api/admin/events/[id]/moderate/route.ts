import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';

const VALID_ACTIONS = ['approve', 'reject'] as const;

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
    const { action } = body;

    if (!action || !VALID_ACTIONS.includes(action)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Action must be "approve" or "reject"');
    }

    const newStatus = action === 'approve' ? 'PUBLISHED' : 'CANCELLED';

    const updatedEvent = await db.event.update({
      where: { id },
      data: { status: newStatus },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        organizer: { select: { id: true, name: true, email: true } },
      },
    });

    // Notify the organizer
    await db.notification.create({
      data: {
        userId: event.organizerId,
        title: action === 'approve' ? 'Event Approved' : 'Event Rejected',
        message: `Your event "${event.title}" has been ${action === 'approve' ? 'approved and published' : 'rejected'}.`,
        type: 'EVENT_UPDATE',
        link: `/events/${id}`,
      },
    });

    return NextResponse.json({
      event: updatedEvent,
      message: `Event ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
