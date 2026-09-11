import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { generateSecureToken, hashToken } from '@/lib/tokens';

const resendLimiter = rateLimit({ windowMs: 60_000, maxRequests: 3 });

/**
 * POST /api/auth/verify-email/resend
 * Resend email verification token.
 * Rate limited: 3 per minute.
 */
export async function POST(request: NextRequest) {
  try {
    const rl = resendLimiter(request);
    if (!rl.success) {
      throw new RateLimitError(rl.remaining, rl.resetAt);
    }

    const user = await authenticate(request);

    // Check if already verified
    const fullUser = await db.user.findUnique({ where: { id: user.id } });
    if (!fullUser) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    if (fullUser.emailVerified) {
      throw new ApiError(400, 'ALREADY_VERIFIED', 'Email is already verified');
    }

    // Invalidate previous unused tokens
    await db.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Generate new token
    const token = generateSecureToken();
    const tokenHash = await hashToken(token);

    await db.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // In development, return the token for testing; in production, would send email
    const isDev = process.env.NODE_ENV !== 'production';

    return NextResponse.json({
      success: true,
      ...(isDev && { token }), // Only in dev for testing
    });
  } catch (error) {
    return handleApiError(error);
  }
}
