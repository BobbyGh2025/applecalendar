import { NextResponse } from 'next/server';

/**
 * GET /api/health — Liveness probe
 *
 * Returns 200 if the application process is alive.
 * Does NOT check database or external dependencies.
 * Use /api/ready for dependency-aware checks.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'applecalendar',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache',
      },
    }
  );
}
