import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { acceptInvitationSchema } from '@/lib/validations';

/**
 * POST /api/organizer/invitations/accept
 * Accept an invitation to join an organization.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const body = await request.json();

    const parsed = acceptInvitationSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { token } = parsed.data;

    // Find the invitation by token
    const invitation = await db.organizerInvitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      throw new ApiError(400, 'INVALID_TOKEN', 'Invalid invitation token');
    }

    if (invitation.acceptedAt) {
      throw new ApiError(400, 'TOKEN_USED', 'This invitation has already been accepted');
    }

    if (invitation.expiresAt < new Date()) {
      throw new ApiError(400, 'TOKEN_EXPIRED', 'This invitation has expired');
    }

    // Verify the user's email matches the invitation
    if (user.email !== invitation.email) {
      throw new ApiError(403, 'FORBIDDEN', 'This invitation was sent to a different email address');
    }

    // Check if already a member
    const existingMembership = await db.organizerMembership.findUnique({
      where: { organizerId_userId: { organizerId: invitation.organizerId, userId: user.id } },
    });

    if (existingMembership && existingMembership.status === 'ACTIVE') {
      throw new ApiError(409, 'CONFLICT', 'You are already a member of this organization');
    }

    // Create membership
    const membership = await db.organizerMembership.create({
      data: {
        organizerId: invitation.organizerId,
        userId: user.id,
        role: invitation.role,
        permissions: invitation.permissions,
        invitedByEmail: invitation.email,
        status: 'ACTIVE',
      },
    });

    // Mark invitation as accepted
    await db.organizerInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    // Update user role to STAFF if they were PUBLIC
    if (user.role === 'PUBLIC') {
      await db.user.update({
        where: { id: user.id },
        data: { role: 'STAFF' },
      });
    }

    // Get the organizer profile
    const organizer = await db.organizerProfile.findUnique({
      where: { id: invitation.organizerId },
      select: { organizationName: true },
    });

    return NextResponse.json({
      success: true,
      membership: {
        id: membership.id,
        role: membership.role,
        organizationName: organizer?.organizationName,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
