import { NextRequest, NextResponse } from 'next/server';
import { authenticate, revokeAllOtherSessions, extractSessionId } from '@/lib/auth';
import { db } from '@/lib/db';
import { compare, hash } from 'bcryptjs';
import { handleApiError, ApiError } from '@/lib/errors';
import { changePasswordSchema } from '@/lib/validations';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';

// Rate limit: 3 password change attempts per 15 minutes
const passwordChangeLimiter = rateLimit({ windowMs: 15 * 60_000, maxRequests: 3 });

/**
 * PATCH /api/users/me/password — Change the current user's password.
 *
 * Requirements:
 * - Current password must be provided and match
 * - New password must meet strength requirements (Zod schema)
 * - New password must differ from the current password
 * - All OTHER sessions are revoked (current session stays active)
 * - Rate limited to 3 attempts per 15 minutes
 */
export async function PATCH(request: NextRequest) {
  try {
    const rl = passwordChangeLimiter(request);
    if (!rl.success) {
      throw new RateLimitError(rl.remaining, rl.resetAt);
    }

    const user = await authenticate(request);
    const body = await request.json();

    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { currentPassword, newPassword } = parsed.data;

    // Fetch the current password hash
    const userWithPassword = await db.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    });

    if (!userWithPassword) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    // Verify current password
    const isCurrentPasswordValid = await compare(currentPassword, userWithPassword.password);
    if (!isCurrentPasswordValid) {
      throw new ApiError(401, 'AUTH_ERROR', 'Current password is incorrect');
    }

    // Prevent reuse of the current password
    const isSamePassword = await compare(newPassword, userWithPassword.password);
    if (isSamePassword) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'New password must be different from the current password');
    }

    // Hash the new password
    const hashedNewPassword = await hash(newPassword, 12);

    // Update the password
    await db.user.update({
      where: { id: user.id },
      data: { password: hashedNewPassword },
    });

    // Revoke all OTHER sessions (keep the current one active)
    const currentSessionId = await extractSessionId(request);
    const revokedCount = currentSessionId
      ? await revokeAllOtherSessions(user.id, currentSessionId)
      : await revokeAllOtherSessions(user.id, '');

    // Log audit event
    await db.auditLog.create({
      data: {
        actorId: user.id,
        action: 'PASSWORD_CHANGE',
        entityType: 'User',
        entityId: user.id,
        newValue: JSON.stringify({ sessionsRevoked: revokedCount }),
      },
    }).catch(() => {}); // Non-blocking

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
      sessionsRevoked: revokedCount,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
