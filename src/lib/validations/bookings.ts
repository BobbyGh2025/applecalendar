import { z } from 'zod';

/**
 * Schema for creating a booking (POST /api/events/:id/book).
 */
export const createBookingSchema = z.object({
  ticketTypeId: z
    .string()
    .min(1, 'Ticket type ID is required'),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1')
    .max(100, 'Cannot book more than 100 tickets in a single order'),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
