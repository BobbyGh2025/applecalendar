import { z } from 'zod';

/**
 * Schema for creating a review (POST /api/events/:id/reviews).
 * One review per user per event (enforced server-side).
 */
export const createReviewSchema = z.object({
  rating: z
    .number()
    .int('Rating must be an integer')
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating cannot exceed 5'),
  comment: z
    .string()
    .max(1000, 'Comment must be 1000 characters or fewer')
    .optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
