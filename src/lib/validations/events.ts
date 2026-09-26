import { z } from 'zod';
import {
  paginationSchema,
  urlField,
  optionalUrlField,
  optionalTimeField,
  dateStringField,
  optionalDateStringField,
  latitudeField,
  longitudeField,
  currencyField,
  dateFilterField,
  eventStatusField,
} from './common';

// ---- Ticket type sub-schema ----

const ticketTypeSchema = z.object({
  name: z
    .string()
    .min(1, 'Ticket type name is required')
    .max(100, 'Ticket type name must be 100 characters or fewer'),
  price: z
    .number()
    .min(0, 'Price cannot be negative')
    .default(0),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .positive('Quantity must be at least 1'),
  minPerOrder: z
    .number()
    .int('minPerOrder must be an integer')
    .min(1, 'Minimum per order must be at least 1')
    .default(1),
  maxPerOrder: z
    .number()
    .int('maxPerOrder must be an integer')
    .min(1, 'Maximum per order must be at least 1')
    .default(10),
  saleStart: z.union([dateStringField, z.undefined()]),
  saleEnd: z.union([dateStringField, z.undefined()]),
  description: z.string().max(500, 'Ticket description must be 500 characters or fewer').optional(),
});

export type TicketTypeInput = z.infer<typeof ticketTypeSchema>;

// ---- Create Event ----

/**
 * Schema for creating a new event (POST /api/events).
 * Validates all event fields including venue, tickets, and tags.
 * Cross-field refinements enforce venueName when !isVirtual and date ordering.
 */
export const createEventSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Title is required')
      .max(200, 'Title must be 200 characters or fewer'),
    description: z
      .string()
      .min(10, 'Description must be at least 10 characters'),
    shortDescription: z
      .string()
      .max(300, 'Short description must be 300 characters or fewer')
      .optional(),
    coverImage: optionalUrlField,
    startDate: dateStringField,
    endDate: optionalDateStringField,
    startTime: optionalTimeField,
    endTime: optionalTimeField,
    timezone: z.string().max(50, 'Timezone must be 50 characters or fewer').optional(),
    venueId: z.string().min(1, 'Venue ID cannot be empty').optional(),
    venueName: z.string().max(200, 'Venue name must be 200 characters or fewer').optional(),
    venueAddress: z.string().max(300, 'Address must be 300 characters or fewer').optional(),
    venueCity: z.string().max(100, 'City must be 100 characters or fewer').optional(),
    venueState: z.string().max(100, 'State must be 100 characters or fewer').optional(),
    venueCountry: z.string().max(100, 'Country must be 100 characters or fewer').optional(),
    venueLat: latitudeField.optional(),
    venueLng: longitudeField.optional(),
    isVirtual: z.boolean().default(false),
    virtualUrl: optionalUrlField,
    capacity: z
      .number()
      .int('Capacity must be an integer')
      .positive('Capacity must be a positive number')
      .optional(),
    categoryId: z.string().min(1, 'Category ID cannot be empty').optional(),
    currency: currencyField.optional(),
    tags: z
      .array(z.string().min(1, 'Tag cannot be empty').max(50, 'Tag must be 50 characters or fewer'))
      .max(10, 'Maximum 10 tags allowed')
      .optional(),
    ticketTypes: z.array(ticketTypeSchema).max(20, 'Maximum 20 ticket types allowed').optional(),
    isFeatured: z.boolean().optional(),
    isPaid: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // If not virtual and no venueId, venueName is required
    if (!data.isVirtual && !data.venueId && (!data.venueName || data.venueName.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Venue name is required for non-virtual events',
        path: ['venueName'],
      });
    }

    // Ensure startDate is parseable and not in the past
    const startDate = new Date(data.startDate);
    if (isNaN(startDate.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid start date',
        path: ['startDate'],
      });
    }

    // If endDate is provided, it must be after startDate
    if (data.endDate) {
      const endDate = new Date(data.endDate);
      if (!isNaN(endDate.getTime()) && endDate < startDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'End date must be after start date',
          path: ['endDate'],
        });
      }
    }

    // Validate ticket types
    if (data.ticketTypes) {
      for (let i = 0; i < data.ticketTypes.length; i++) {
        const tt = data.ticketTypes[i];
        if (tt.saleStart && tt.saleEnd) {
          if (new Date(tt.saleEnd) <= new Date(tt.saleStart)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Sale end date must be after sale start date',
              path: ['ticketTypes', i, 'saleEnd'],
            });
          }
        }
        if (tt.minPerOrder > tt.maxPerOrder) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'minPerOrder cannot exceed maxPerOrder',
            path: ['ticketTypes', i, 'minPerOrder'],
          });
        }
      }
    }
  });

export type CreateEventInput = z.infer<typeof createEventSchema>;

// ---- Update Event ----

/**
 * Schema for partially updating an event (PATCH /api/events/:id).
 * All fields are optional since it's a partial update.
 */
export const updateEventSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Title cannot be empty')
      .max(200, 'Title must be 200 characters or fewer')
      .optional(),
    description: z
      .string()
      .min(10, 'Description must be at least 10 characters')
      .optional(),
    shortDescription: z
      .string()
      .max(300, 'Short description must be 300 characters or fewer')
      .optional(),
    coverImage: z.union([urlField, z.literal('')]).optional(),
    startDate: dateStringField.optional(),
    endDate: z.union([dateStringField, z.literal('')]).optional(),
    startTime: optionalTimeField,
    endTime: optionalTimeField,
    timezone: z.string().max(50, 'Timezone must be 50 characters or fewer').optional(),
    venueId: z.union([z.string().min(1, 'Venue ID cannot be empty'), z.literal('')]).optional(),
    venueName: z.string().max(200, 'Venue name must be 200 characters or fewer').optional(),
    venueAddress: z.string().max(300, 'Address must be 300 characters or fewer').optional(),
    venueCity: z.string().max(100, 'City must be 100 characters or fewer').optional(),
    venueState: z.string().max(100, 'State must be 100 characters or fewer').optional(),
    venueCountry: z.string().max(100, 'Country must be 100 characters or fewer').optional(),
    venueLat: latitudeField.optional(),
    venueLng: longitudeField.optional(),
    isVirtual: z.boolean().optional(),
    virtualUrl: z.union([urlField, z.literal('')]).optional(),
    capacity: z
      .number()
      .int('Capacity must be an integer')
      .positive('Capacity must be a positive number')
      .optional(),
    categoryId: z.union([z.string().min(1), z.literal('')]).optional(),
    currency: currencyField.optional(),
    tags: z
      .array(z.string().min(1, 'Tag cannot be empty').max(50, 'Tag must be 50 characters or fewer'))
      .max(10, 'Maximum 10 tags allowed')
      .optional(),
    isFeatured: z.boolean().optional(),
    isPaid: z.boolean().optional(),
    status: eventStatusField.optional(),
  });

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// ---- Event Query (GET /api/events) ----

/**
 * Schema for event listing query parameters.
 */
export const eventQuerySchema = paginationSchema.extend({
  search: z.string().max(200, 'Search query too long').optional(),
  category: z.string().max(100, 'Category filter too long').optional(),
  date: dateFilterField,
  featured: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  status: eventStatusField.optional(),
});

export type EventQueryInput = z.infer<typeof eventQuerySchema>;
