import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate, requireRole } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { createAdSchema, adsQuerySchema } from '@/lib/validations';
import { getOperableOrganizerEntitlements, requireFeature, resolveOrganizerProfile } from '@/lib/services/entitlements';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const parsed = adsQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { position, status } = parsed.data;

    const where: Record<string, unknown> = { status: status || 'ACTIVE' };
    if (position) {
      where.position = position;
    }

    const ads = await db.advertisement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ ads });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    requireRole('ORGANIZER', 'SUPER_ADMIN')(user);

    // Phase 4B: Entitlement enforcement — check canAdvertise feature flag
    if (user.role === 'ORGANIZER') {
      const entitlements = await getOperableOrganizerEntitlements(user.id);
      requireFeature(entitlements, 'canAdvertise');
    }

    const body = await request.json();

    const parsed = createAdSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const {
      title,
      imageUrl,
      linkUrl,
      position,
      startDate,
      endDate,
      eventId,
    } = parsed.data;

    // Resolve organizer profile for proper ad ownership
    const organizerProfile = user.role === 'ORGANIZER' ? await resolveOrganizerProfile(user.id) : null;

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
        organizerId: organizerProfile?.id,
      },
    });

    return NextResponse.json({ ad }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
