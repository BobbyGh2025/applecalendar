import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, ApiError } from '@/lib/errors';
import { resetPasswordSchema } from '@/lib/validations';
import { hashToken } from '@/lib/tokens';
import { hash } from 'bcryptjs';
import { revokeAllRefreshTokens } from '@/lib/auth';

/**
 * POST /api/auth/reset-password
 * Reset password using a valid reset token.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { token, newPassword } = parsed.data;

    // Hash the token to look it up
    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetToken = await db.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken) {
      throw new ApiError(400, 'INVALID_TOKEN', 'Invalid reset token');
    }

    if (resetToken.usedAt) {
      throw new ApiError(400, 'TOKEN_USED', 'This reset token has already been used');
    }

    if (resetToken.expiresAt < new Date()) {
      throw new ApiError(400, 'TOKEN_EXPIRED', 'This reset token has expired');
    }

    // Hash the new password
    const hashedPassword = await hash(newPassword, 12);

    // Update user password
    await db.user.update({
      where: { id: resetToken.userId },
      data: { password: hashedPassword },
    });

    // Mark token as used
    await db.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    // Revoke all refresh tokens (force re-login)
    await revokeAllRefreshTokens(resetToken.userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
