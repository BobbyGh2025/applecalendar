import { z } from 'zod';
import { emailField, passwordField } from './common';

// ─── Forgot Password ───

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// ─── Reset Password ───

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: passwordField,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ─── Change Password ───

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordField,
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ─── Verify Email ───

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

// ─── Resend Verification ─── (empty body — just needs auth)

export const resendVerificationSchema = z.object({});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

// ─── Refresh Token ───

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// ─── Update User Profile ───

export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer').optional(),
  avatar: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  bio: z.string().max(500, 'Bio must be 500 characters or fewer').optional(),
  phone: z.string().max(30, 'Phone must be 30 characters or fewer').optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ─── Update Organizer Profile ───

export const updateOrganizerProfileSchema = z.object({
  organizationName: z.string().min(1, 'Organization name is required').max(200, 'Organization name must be 200 characters or fewer').optional(),
  description: z.string().max(2000, 'Description must be 2000 characters or fewer').optional(),
  logo: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  coverImage: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  website: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  contactEmail: z.string().email('Invalid email format').optional().or(z.literal('')),
  phone: z.string().max(30, 'Phone must be 30 characters or fewer').optional(),
  address: z.string().max(300, 'Address must be 300 characters or fewer').optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  socialLinks: z.record(z.string(), z.string()).optional(),
});

export type UpdateOrganizerProfileInput = z.infer<typeof updateOrganizerProfileSchema>;

// ─── Invite Staff ───

export const inviteStaffSchema = z.object({
  email: emailField,
  role: z.enum(['STAFF', 'MANAGER']).default('STAFF'),
  permissions: z.array(z.string()).default([]),
});

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

// ─── Update Member ───

export const updateMemberSchema = z.object({
  role: z.enum(['OWNER', 'MANAGER', 'STAFF']).optional(),
  permissions: z.array(z.string()).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

// ─── Accept Invitation ───

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
