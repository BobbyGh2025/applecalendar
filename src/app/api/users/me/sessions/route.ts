import { NextRequest, NextResponse } from 'next/server';
import { authenticate, extractSessionId, listActiveSessions } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

/**
 * GET /api/users/me/sessions — List the current user's active sessions.
 *
 * Returns session info: creation time, expiration, and a current-session indicator.
 * Never exposes raw token hashes.
 * Uses RefreshToken records as the session authority (no UserSession model).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    const currentSessionId = await extractSessionId(request);

    const sessions = await listActiveSessions(user.id, currentSessionId ?? undefined);

    return NextResponse.json({
      success: true,
      sessions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
