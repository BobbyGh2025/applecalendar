import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

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
    return handleApiError(error);
  }
}
