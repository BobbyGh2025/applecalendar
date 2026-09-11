import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, ApiError } from '@/lib/errors';
import { verifyEmailSchema } from '@/lib/validations';
import { verifyTokenHash } from '@/lib/tokens';

/**
 * POST /api/auth/verify-email
 * Verify email address using a verification token.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = verifyEmailSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { token } = parsed.data;

    // Hash the token to look it up
    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const verificationToken = await db.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verificationToken) {
      throw new ApiError(400, 'INVALID_TOKEN', 'Invalid verification token');
    }

    if (verificationToken.usedAt) {
      throw new ApiError(400, 'TOKEN_USED', 'This verification token has already been used');
    }

    if (verificationToken.expiresAt < new Date()) {
      throw new ApiError(400, 'TOKEN_EXPIRED', 'This verification token has expired');
    }

    // Mark user email as verified
    await db.user.update({
      where: { id: verificationToken.userId },
      data: { emailVerified: new Date() },
    });

    // Mark token as used
    await db.emailVerificationToken.update({
      where: { id: verificationToken.id },
      data: { usedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
