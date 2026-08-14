import { z } from 'zod';
import { paginationSchema, notificationTypes } from './common';

/**
 * Schema for querying notifications (GET /api/notifications).
 */
export const notificationsQuerySchema = paginationSchema.extend({
  unreadOnly: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  type: z.enum(notificationTypes, {
    message: 'Invalid notification type',
  }).optional(),
});

export type NotificationsQueryInput = z.infer<typeof notificationsQuerySchema>;
