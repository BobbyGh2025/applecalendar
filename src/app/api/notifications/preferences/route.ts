import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import {
  getNotificationPreferences,
  setNotificationPreference,
  NotificationType,
  DeliveryChannel,
} from '@/lib/services/notification-service';

/**
 * Phase 6B fix D3: expose notification preference management.
 *
 * GET  /api/notifications/preferences — list the authenticated user's
 *      preferences. An empty list means "all defaults" (IN_APP enabled,
 *      EMAIL/SMS off until a row exists).
 * PUT  /api/notifications/preferences — upsert ONE { type, channel, enabled }
 *      preference for the authenticated user.
 *
 * Ownership: userId is ALWAYS taken from the authenticated session — the
 * request body can never target another user.
 */

const NOTIFICATION_TYPES = Object.values(NotificationType) as string[];
const NOTIFICATION_CHANNELS = Object.values(DeliveryChannel) as string[];

const putPreferenceSchema = z.object({
  type: z.string().refine((v) => NOTIFICATION_TYPES.includes(v), {
    message: `type must be one of: ${NOTIFICATION_TYPES.join(', ')}`,
  }),
  channel: z.string().refine((v) => NOTIFICATION_CHANNELS.includes(v), {
    message: `channel must be one of: ${NOTIFICATION_CHANNELS.join(', ')}`,
  }),
  enabled: z.boolean(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const preferences = await getNotificationPreferences(user.id);

    return NextResponse.json({
      preferences,
      defaults: {
        note: 'Missing type+channel combinations fall back to: IN_APP enabled, EMAIL/SMS disabled',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await authenticate(request);

    const body = await request.json().catch(() => null);
    const parsed = putPreferenceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid preference payload',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    const { type, channel, enabled } = parsed.data;

    // Upsert scoped to the authenticated user — cross-user writes impossible.
    const preference = await setNotificationPreference(
      user.id,
      type,
      channel,
      enabled,
    );

    return NextResponse.json({ preference });
  } catch (error) {
    return handleApiError(error);
  }
}
