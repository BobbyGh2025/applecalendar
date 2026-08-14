import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    const categories = await db.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { events: true } },
      },
    });

    return NextResponse.json({ categories });
  } catch (error) {
    return handleApiError(error);
  }
}
