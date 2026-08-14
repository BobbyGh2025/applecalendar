import { z } from 'zod';
import { paginationSchema, userRoleField } from './common';

/**
 * Schema for admin updating a user (PATCH /api/admin/users/:id).
 */
export const updateUserSchema = z.object({
  isActive: z.boolean().optional(),
  role: userRoleField.optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * Schema for listing users with search & pagination (GET /api/admin/users).
 */
export const usersQuerySchema = paginationSchema.extend({
  search: z.string().max(200, 'Search query too long').optional(),
  role: userRoleField.optional(),
  isActive: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
});

export type UsersQueryInput = z.infer<typeof usersQuerySchema>;
