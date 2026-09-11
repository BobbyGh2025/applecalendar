import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, ApiError } from '@/lib/errors';
import { forgotPasswordSchema } from '@/lib/validations';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';
import { generateSecureToken, hashToken } from '@/lib/tokens';

const forgotLimiter = rateLimit({ windowMs: 60_000, maxRequests: 3 });

/**
 * POST /api/auth/forgot-password
 * Request a password reset. Always returns 200 (anti-enumeration).
 * Rate limited: 3 per minute.
 */
export async function POST(request: NextRequest) {
  try {
    const rl = forgotLimiter(request);
    if (!rl.success) {
      throw new RateLimitError(rl.remaining, rl.resetAt);
    }

    const body = await request.json();

    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { email } = parsed.data;

    // Always return 200 — anti-enumeration
    const user = await db.user.findUnique({ where: { email } });

    if (user) {
      // Invalidate previous unused tokens
      await db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      // Generate new token
      const token = generateSecureToken();
      const tokenHash = await hashToken(token);

      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      // In development, return the token for testing; in production, would send email
      const isDev = process.env.NODE_ENV !== 'production';

      return NextResponse.json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent.',
        ...(isDev && { token }), // Only in dev for testing
      });
    }

    // Even if user doesn't exist, return same response
    return NextResponse.json({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent.',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
