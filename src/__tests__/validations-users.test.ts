import { describe, it, expect } from 'vitest';
import { updateUserSchema, usersQuerySchema } from '@/lib/validations/users';

describe('updateUserSchema', () => {
  it('Empty object passes (all optional)', () => {
    const result = updateUserSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('Valid isActive update passes', () => {
    const result = updateUserSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
    expect(result.data!.isActive).toBe(false);
  });

  it('Valid role update passes', () => {
    const result = updateUserSchema.safeParse({ role: 'ORGANIZER' });
    expect(result.success).toBe(true);
    expect(result.data!.role).toBe('ORGANIZER');
  });

  it('Invalid role fails', () => {
    const result = updateUserSchema.safeParse({ role: 'INVALID_ROLE' });
    expect(result.success).toBe(false);
  });
});

describe('usersQuerySchema', () => {
  it('Default pagination values', () => {
    const result = usersQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data!.page).toBe(1);
    expect(result.data!.limit).toBe(12);
  });

  it('Invalid role rejected', () => {
    const result = usersQuerySchema.safeParse({ role: 'SUPERUSER' });
    expect(result.success).toBe(false);
  });
});
