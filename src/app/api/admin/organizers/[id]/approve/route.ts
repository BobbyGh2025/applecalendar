import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import {
  executeLifecycleTransition,
  ORGANIZER_APPROVED,
} from '@/lib/services/organizer-lifecycle';

/**
 * PATCH /api/admin/organizers/:id/approve
 *
 * Approve an organizer profile (PENDING_APPROVAL/APPROVED → ACTIVE).
 * SUPER_ADMIN only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const result = await executeLifecycleTransition({
      organizerId: id,
      action: ORGANIZER_APPROVED,
      actorId: user.id,
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
