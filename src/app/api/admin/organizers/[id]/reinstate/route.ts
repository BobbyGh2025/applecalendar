import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import {
  executeLifecycleTransition,
  ORGANIZER_REINSTATED,
} from '@/lib/services/organizer-lifecycle';

/**
 * PATCH /api/admin/organizers/:id/reinstate
 *
 * Reinstate a suspended organizer profile (SUSPENDED → ACTIVE).
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
      action: ORGANIZER_REINSTATED,
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
