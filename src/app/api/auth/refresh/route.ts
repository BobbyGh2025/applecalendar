import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { refreshSession, verifyRefreshToken } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { refreshTokenSchema } from '@/lib/validations';

/**
 * POST /api/auth/refresh
 * Refresh token rotation: verify refresh token, revoke old, issue new pair.
 * Uses the consolidated refreshSession() flow.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = refreshTokenSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { refreshToken } = parsed.data;

    // Use the consolidated refresh flow
    const result = await refreshSession(refreshToken);

    // Fetch user for response (refreshSession already verified the user is active)
    const payload = await verifyRefreshToken(result.refreshToken);
    const user = payload ? await db.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true, avatar: true, bio: true, phone: true },
    }) : null;

    return NextResponse.json({
      user,
      token: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
