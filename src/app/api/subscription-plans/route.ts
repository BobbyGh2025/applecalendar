import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    const plans = await db.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ plans });
  } catch (error) {
    return handleApiError(error);
  }
}
