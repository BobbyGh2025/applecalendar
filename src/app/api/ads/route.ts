import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole, AuthError } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const position = searchParams.get('position') || '';

    const where: Record<string, unknown> = { status: 'ACTIVE' };
    if (position) {
      where.position = position;
    }

    const ads = await db.advertisement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ ads });
  } catch (error) {
    console.error('Ads GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    const body = await request.json();
    const {
      title,
      imageUrl,
      linkUrl,
      position,
      startDate,
      endDate,
      eventId,
    } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const ad = await db.advertisement.create({
      data: {
        title,
        imageUrl,
        linkUrl,
        position: position || 'SIDEBAR',
        status: 'ACTIVE',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        eventId,
        advertiserId: user.id,
      },
    });

    return NextResponse.json({ ad }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Ads POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
