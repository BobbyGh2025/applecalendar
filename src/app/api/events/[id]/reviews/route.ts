import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { createReviewSchema } from '@/lib/validations';

/**
 * POST /api/events/:id/reviews
 * Submit a review for an event.
 * Auth required. One review per user per event (server-side enforced).
 * Only users who have a confirmed booking may review.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticate(request);
    const { id: eventId } = await params;

    // Verify event exists and is published
    const event = await db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new ApiError(404, 'NOT_FOUND', 'Event not found');
    }

    // Duplicate review check — server-side, regardless of frontend
    const existingReview = await db.review.findUnique({
      where: { userId_eventId: { userId: user.id, eventId } },
    });
    if (existingReview) {
      throw new ApiError(400, 'DUPLICATE_REVIEW', 'You have already reviewed this event');
    }

    // Verify the user has a confirmed booking for this event
    const confirmedBooking = await db.booking.findFirst({
      where: {
        userId: user.id,
        eventId,
        status: { in: ['CONFIRMED', 'PENDING'] },
      },
    });
    if (!confirmedBooking) {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'You must have a booking for this event to submit a review'
      );
    }

    // Validate input
    const body = await request.json();
    const parsed = createReviewSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const { rating, comment } = parsed.data;

    const review = await db.review.create({
      data: {
        userId: user.id,
        eventId,
        rating,
        comment,
      },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
      },
    });

    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
