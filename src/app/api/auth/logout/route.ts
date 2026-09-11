import { NextRequest, NextResponse } from 'next/server';
import { authenticate, revokeAllRefreshTokens } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

/**
 * POST /api/auth/logout
 * Logout: revoke all refresh tokens for the authenticated user.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    await revokeAllRefreshTokens(user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
