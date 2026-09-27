import { z } from 'zod';

/**
 * Pagination schema for list endpoints.
 * Uses z.coerce to parse query string numbers.
 */
export const paginationSchema = z.object({
  page: z.coerce
    .number()
    .int('Page must be an integer')
    .min(1, 'Page must be at least 1')
    .default(1),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(12),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/**
 * Dynamic route parameter schema for /:id endpoints.
 */
export const idParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

export type IdParamInput = z.infer<typeof idParamSchema>;

// ---- Shared field-level schemas ----

/** Valid email address */
export const emailField = z.string().email('Invalid email format');

/** Password with minimum length */
export const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters');

/** Safe URL schemes — prevents javascript:/data: XSS when rendered in <a href> */
const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/** URL field — must be a valid URL with a safe scheme (http/https/mailto/tel) */
export const urlField = z
  .string()
  .url('Must be a valid URL')
  .refine(
    (val) => {
      try {
        return SAFE_URL_SCHEMES.includes(new URL(val).protocol);
      } catch {
        return false;
      }
    },
    'Only http://, https://, mailto:, and tel: URLs are allowed'
  );

/** Optional URL field — passes through null/undefined */
export const optionalUrlField = z.union([urlField, z.undefined()]);

/** Time string in HH:MM format (24-hour) */
export const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:MM format (24-hour)');

/** Optional time string in HH:MM format */
export const optionalTimeField = z.union([timeField, z.undefined()]);

/** Date string that can be parsed by the Date constructor */
export const dateStringField = z
  .string()
  .min(1, 'Date is required')
  .refine(
    (val) => !isNaN(Date.parse(val)),
    'Invalid date string'
  );

/** Optional date string */
export const optionalDateStringField = z.union([dateStringField, z.undefined()]);

/** 3-letter ISO 4217 currency code */
export const currencyField = z
  .string()
  .length(3, 'Currency must be a 3-letter code (e.g. USD)')
  .regex(/^[A-Z]{3}$/, 'Currency must be uppercase 3-letter code');

/** Latitude: -90 to 90 */
export const latitudeField = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

/** Longitude: -180 to 180 */
export const longitudeField = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

/** User roles used throughout the app */
export const userRoles = ['PUBLIC', 'ORGANIZER', 'STAFF', 'SUPER_ADMIN'] as const;
export const userRoleField = z.enum(userRoles, {
  message: 'Invalid role',
});

/** Event statuses */
export const eventStatuses = ['DRAFT', 'PENDING', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] as const;
export const eventStatusField = z.enum(eventStatuses, {
  message: 'Invalid event status',
});

/** Booking statuses */
export const bookingStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED'] as const;

/** Payment statuses */
export const paymentStatuses = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'] as const;

/** Ad positions */
export const adPositions = ['SIDEBAR', 'BANNER', 'POPUP'] as const;
export const adPositionField = z.enum(adPositions, {
  message: 'Invalid ad position',
});

/** Ad statuses */
export const adStatuses = ['ACTIVE', 'PAUSED', 'EXPIRED'] as const;
export const adStatusField = z.enum(adStatuses, {
  message: 'Invalid ad status',
});

/** Notification types */
export const notificationTypes = ['INFO', 'BOOKING', 'PAYMENT', 'EVENT_UPDATE', 'SYSTEM'] as const;

/** Date filter values for events listing */
export const dateFilterValues = ['thisWeek', 'thisMonth', 'nextMonth', 'all'] as const;
export const dateFilterField = z.enum(dateFilterValues).optional();
