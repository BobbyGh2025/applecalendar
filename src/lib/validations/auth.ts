import { z } from 'zod';
import { emailField, passwordField } from './common';

/**
 * Login request body.
 * Requires a literal 'login' action discriminator.
 */
export const loginSchema = z.object({
  action: z.literal('login', {
    message: 'Action must be "login"',
  }),
  email: emailField,
  password: passwordField,
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Registration request body.
 * Requires a literal 'register' action discriminator.
 */
export const registerSchema = z.object({
  action: z.literal('register', {
    message: 'Action must be "register"',
  }),
  email: emailField,
  password: passwordField,
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer'),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Union of login and register schemas for the unified auth endpoint.
 */
export const authSchema = z.discriminatedUnion('action', [loginSchema, registerSchema]);

export type AuthInput = z.infer<typeof authSchema>;
