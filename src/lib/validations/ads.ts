import { z } from 'zod';
import {
  paginationSchema,
  optionalUrlField,
  dateStringField,
  optionalDateStringField,
  adPositionField,
  adStatusField,
} from './common';

/**
 * Schema for creating an advertisement (POST /api/ads).
 */
export const createAdSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be 200 characters or fewer'),
  imageUrl: optionalUrlField,
  linkUrl: optionalUrlField,
  position: adPositionField.default('SIDEBAR'),
  startDate: optionalDateStringField,
  endDate: optionalDateStringField,
  eventId: z.string().min(1, 'Event ID cannot be empty').optional(),
});

export type CreateAdInput = z.infer<typeof createAdSchema>;

/**
 * Schema for updating an advertisement (PATCH /api/ads/:id).
 */
export const updateAdSchema = z.object({
  title: z
    .string()
    .min(1, 'Title cannot be empty')
    .max(200, 'Title must be 200 characters or fewer')
    .optional(),
  imageUrl: z.union([z.string().url('Must be a valid URL'), z.literal('')]).optional(),
  linkUrl: z.union([z.string().url('Must be a valid URL'), z.literal('')]).optional(),
  position: adPositionField.optional(),
  status: adStatusField.optional(),
  startDate: z.union([dateStringField, z.literal('')]).optional(),
  endDate: z.union([dateStringField, z.literal('')]).optional(),
});

export type UpdateAdInput = z.infer<typeof updateAdSchema>;

/**
 * Schema for querying advertisements (GET /api/ads).
 */
export const adsQuerySchema = paginationSchema.extend({
  position: adPositionField.optional(),
  status: adStatusField.optional(),
});

export type AdsQueryInput = z.infer<typeof adsQuerySchema>;
