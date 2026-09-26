import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import {
  executeLifecycleTransition,
  ORGANIZER_REJECTED,
} from '@/lib/services/organizer-lifecycle';

/**
 * PATCH /api/admin/organizers/:id/reject
 *
 * Reject an organizer profile (PENDING_APPROVAL/APPROVED → REJECTED).
 * SUPER_ADMIN only.
 * Body: { reason: string } (required)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const body = await request.json();
    const { reason } = body;

    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Reason is required when rejecting an organizer');
    }

    const result = await executeLifecycleTransition({
      organizerId: id,
      action: ORGANIZER_REJECTED,
      actorId: user.id,
      reason: reason.trim(),
    });

    return NextResponse.json({
      success: true,
      profile: result.profile,
      auditLog: result.auditLog,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
