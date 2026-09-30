import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/ready — Readiness probe
 *
 * Returns 200 if the application is ready to serve traffic.
 * Checks critical dependencies: database connectivity.
 * Returns 503 if any critical dependency is unavailable.
 * Never exposes connection strings or detailed failure internals.
 */
export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number }> = {};

  // Database check
  try {
    const start = Date.now();
    await db.$queryRaw`SELECT 1`;
    checks.database = {
      status: 'ok',
      latencyMs: Date.now() - start,
    };
  } catch {
    checks.database = {
      status: 'error',
    };
  }

  const allOk = Object.values(checks).every(c => c.status === 'ok');

  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      service: 'applecalendar',
      checks,
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache',
      },
    }
  );
}
