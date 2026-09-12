import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { verifyOrganizerSchema } from '@/lib/validations';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    requireRole('SUPER_ADMIN')(user);
    const { id } = await params;

    const profile = await db.organizerProfile.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (!profile) {
      throw new ApiError(404, 'NOT_FOUND', 'Organizer profile not found');
    }

    const body = await request.json();
    const parsed = verifyOrganizerSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { action, reason } = parsed.data;

    // Cannot verify an already-verified profile
    if (profile.verificationStatus === 'VERIFIED' && action === 'verify') {
      throw new ApiError(400, 'ALREADY_VERIFIED', 'Organizer profile is already verified');
    }

    // Cannot reject an already-rejected profile without re-submission
    if (profile.verificationStatus === 'REJECTED' && action === 'reject') {
      throw new ApiError(400, 'ALREADY_REJECTED', 'Organizer profile is already rejected');
    }

    let updateData: Record<string, unknown>;

    if (action === 'verify') {
      updateData = {
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
      };
    } else {
      updateData = {
        verificationStatus: 'REJECTED',
        verifiedAt: null,
      };
    }

    const updatedProfile = await db.organizerProfile.update({
      where: { id },
      data: updateData,
    });

    // Create a notification to the organizer
    await db.notification.create({
      data: {
        userId: profile.userId,
        title: action === 'verify' ? 'Organizer Profile Verified' : 'Organizer Profile Rejected',
        message: action === 'verify'
          ? `Your organizer profile "${profile.organizationName}" has been verified! You can now publish events.`
          : `Your organizer profile "${profile.organizationName}" has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
        type: 'SYSTEM',
      },
    });

    return NextResponse.json({ profile: updatedProfile });
  } catch (error) {
    return handleApiError(error);
  }
}
