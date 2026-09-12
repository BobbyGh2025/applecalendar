import { z } from 'zod';
import { emailField, optionalUrlField } from './common';

export const createOrganizerProfileSchema = z.object({
  organizationName: z.string().min(2, 'Organization name must be at least 2 characters').max(100),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  website: optionalUrlField,
  contactEmail: emailField,
  contactPhone: z.string().min(7, 'Phone number must be at least 7 characters').max(20).optional(),
  logoUrl: optionalUrlField,
  coverImageUrl: optionalUrlField,
  businessAddress: z.string().max(200).optional(),
  businessCity: z.string().max(100).optional(),
  businessState: z.string().max(100).optional(),
  businessCountry: z.string().max(2, 'Use 2-letter country code').default('US'),
  socialLinks: z.object({
    twitter: z.string().optional(),
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    linkedin: z.string().optional(),
  }).optional(),
});

export const updateOrganizerProfileSchema = z.object({
  organizationName: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  website: optionalUrlField,
  contactEmail: emailField.optional(),
  contactPhone: z.string().min(7).max(20).optional(),
  logoUrl: optionalUrlField,
  coverImageUrl: optionalUrlField,
  businessAddress: z.string().max(200).optional(),
  businessCity: z.string().max(100).optional(),
  businessState: z.string().max(100).optional(),
  businessCountry: z.string().max(2).optional(),
  socialLinks: z.object({
    twitter: z.string().optional(),
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    linkedin: z.string().optional(),
  }).optional(),
});

export const verifyOrganizerSchema = z.object({
  action: z.enum(['verify', 'reject'], { message: 'Action must be "verify" or "reject"' }),
  reason: z.string().max(500).optional(), // Reason for rejection
});

export type CreateOrganizerProfileInput = z.infer<typeof createOrganizerProfileSchema>;
export type UpdateOrganizerProfileInput = z.infer<typeof updateOrganizerProfileSchema>;
export type VerifyOrganizerInput = z.infer<typeof verifyOrganizerSchema>;
