import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, revokeAllRefreshTokens } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { changePasswordSchema } from '@/lib/validations';
import { hash, compare } from 'bcryptjs';

/**
 * POST /api/auth/change-password
 * Change password for authenticated user.
 * Requires current password verification.
 * Revokes all refresh tokens (force re-login on other devices).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const body = await request.json();

    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { currentPassword, newPassword } = parsed.data;

    // Get full user with password
    const fullUser = await db.user.findUnique({ where: { id: user.id } });
    if (!fullUser) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    // Verify current password
    const isPasswordValid = await compare(currentPassword, fullUser.password);
    if (!isPasswordValid) {
      throw new ApiError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await hash(newPassword, 12);

    // Update password
    await db.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // Revoke all refresh tokens (force re-login)
    await revokeAllRefreshTokens(user.id);

    // Log audit event
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: 'PASSWORD_CHANGE',
        entityType: 'User',
        entityId: user.id,
      },
    }).catch(() => {}); // Non-blocking

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
