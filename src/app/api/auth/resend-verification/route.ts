import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { createEmailVerificationToken } from '@/lib/email-verification';
import { db } from '@/lib/db';
import { handleApiError, ApiError } from '@/lib/errors';
import { rateLimit, RateLimitError } from '@/lib/rate-limit';

// Rate limit: 3 resend requests per 15 minutes per IP
const resendLimiter = rateLimit({ windowMs: 15 * 60_000, maxRequests: 3 });

/**
 * POST /api/auth/resend-verification — Resend email verification.
 *
 * Requires authentication (Bearer access token).
 *
 * Security properties:
 * - Rate limited: 3 per 15 minutes
 * - If email is already verified, returns success anyway (anti-enumeration)
 * - Invalidates all previous unused tokens before creating a new one
 * - In development mode, returns the raw token in the response
 *   (in production, this would be sent via email and removed from response)
 * - Does NOT return any auth credentials
 */
export async function POST(request: NextRequest) {
  try {
    const rl = resendLimiter(request);
    if (!rl.success) {
      throw new RateLimitError(rl.remaining, rl.resetAt);
    }

    const user = await authenticate(request);

    // Check if already verified
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
      select: { emailVerified: true, email: true },
    });

    if (!fullUser) {
      throw new ApiError(404, 'NOT_FOUND', 'User not found');
    }

    if (fullUser.emailVerified) {
      // Already verified — return success (anti-enumeration)
      return NextResponse.json({
        success: true,
        message: 'If your email is not verified, a new verification link has been sent.',
      });
    }

    // Create a new verification token (invalidates previous unused tokens)
    const rawToken = await createEmailVerificationToken(user.id);

    const response: Record<string, unknown> = {
      success: true,
      message: 'If your email is not verified, a new verification link has been sent.',
    };

    // In development, include the token for testing
    // In production, this would be sent via email and NOT included in the response
    if (process.env.NODE_ENV === 'development') {
      response.devToken = rawToken;
    }

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
