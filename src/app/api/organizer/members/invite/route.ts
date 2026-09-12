import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { inviteStaffSchema } from '@/lib/validations';
import { generateSecureToken, hashToken } from '@/lib/tokens';

/**
 * POST /api/organizer/members/invite
 * Invite a staff member to the organization.
 * Only the organizer owner can invite.
 * Token is stored as SHA-256 hash for security (matching PasswordResetToken/EmailVerificationToken pattern).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);

    if (user.role !== 'ORGANIZER' && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Organizer access required');
    }

    const profile = await db.organizerProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      throw new ApiError(404, 'NOT_FOUND', 'Organizer profile not found');
    }

    const body = await request.json();

    const parsed = inviteStaffSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { email, role, permissions } = parsed.data;

    // Check for existing invitation
    const existingInvitation = await db.organizerInvitation.findUnique({
      where: { organizerId_email: { organizerId: profile.id, email } },
    });

    if (existingInvitation && !existingInvitation.acceptedAt && existingInvitation.expiresAt > new Date()) {
      throw new ApiError(409, 'CONFLICT', 'An active invitation already exists for this email');
    }

    // Check if already a member
    const invitedUser = await db.user.findUnique({ where: { email } });
    if (invitedUser) {
      const existingMembership = await db.organizerMembership.findUnique({
        where: { organizerId_userId: { organizerId: profile.id, userId: invitedUser.id } },
      });
      if (existingMembership && existingMembership.status === 'ACTIVE') {
        throw new ApiError(409, 'CONFLICT', 'This user is already a member of your organization');
      }
    }

    // Clean up expired/accepted invitations for this email
    if (existingInvitation) {
      await db.organizerInvitation.delete({ where: { id: existingInvitation.id } });
    }

    // Create invitation with hashed token
    const rawToken = generateSecureToken();
    const tokenHash = await hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await db.organizerInvitation.create({
      data: {
        organizerId: profile.id,
        email,
        role,
        permissions: JSON.stringify(permissions),
        tokenHash,
        expiresAt,
      },
    });

    // In development, return the raw token for testing; in production, would send email
    const isDev = process.env.NODE_ENV !== 'production';

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      ...(isDev && { token: rawToken }), // Only in dev for testing — never in production
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
