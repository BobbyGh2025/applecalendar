import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({ notifications });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Notifications GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
