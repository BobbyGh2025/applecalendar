/**
 * PATCH /api/admin/organizers/:id/verify — SUPER_ADMIN organizer verification.
 *
 * Phase 6D fix (discovered via tsc --noEmit during the production-readiness
 * audit): this route previously referenced `profile.verificationStatus` and
 * wrote `verificationStatus`/`verifiedAt` — fields that DO NOT EXIST on the
 * OrganizerProfile model (the authoritative field is `status`, managed by
 * organizer-lifecycle.ts). Every call failed at runtime: the guards never
 * fired and the Prisma update rejected the unknown arguments with a 500.
 *
 * The route now delegates to `executeLifecycleTransition`, the single writer
 * for organizer status (legal-transition map, reason enforcement, AuditLog,
 * statusChanged* bookkeeping, backward-compatible approvalStatus).
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { verifyOrganizerSchema } from '@/lib/validations';
import {
  executeLifecycleTransition,
  ORGANIZER_APPROVED,
  ORGANIZER_REJECTED,
} from '@/lib/services/organizer-lifecycle';
import { logger } from '@/lib/logger';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const body = await request.json();
    const parsed = verifyOrganizerSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { action, reason } = parsed.data;

    const result = await executeLifecycleTransition({
      organizerId: id,
      action: action === 'verify' ? ORGANIZER_APPROVED : ORGANIZER_REJECTED,
      actorId: user.id,
      reason,
    });

    logger.info('Organizer verification completed via lifecycle service', {
      organizerId: id,
      action,
      actorId: user.id,
      newStatus: result.profile.status,
    });

    return NextResponse.json({ profile: result.profile });
  } catch (error) {
    return handleApiError(error);
  }
}
