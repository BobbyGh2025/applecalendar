import { describe, it, expect } from 'vitest';
import { authSchema } from '@/lib/validations/auth';

describe('authSchema', () => {
  it('Valid login input passes', () => {
    const result = authSchema.safeParse({
      action: 'login',
      email: 'user@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(true);
  });

  it('Missing email fails', () => {
    const result = authSchema.safeParse({
      action: 'login',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('Invalid email format fails', () => {
    const result = authSchema.safeParse({
      action: 'login',
      email: 'not-an-email',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('Password too short fails', () => {
    const result = authSchema.safeParse({
      action: 'login',
      email: 'user@example.com',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('Valid register input passes', () => {
    const result = authSchema.safeParse({
      action: 'register',
      email: 'new@example.com',
      password: 'password123',
      name: 'John Doe',
    });
    expect(result.success).toBe(true);
  });

  it('Missing name on register fails', () => {
    const result = authSchema.safeParse({
      action: 'register',
      email: 'new@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('Name too long (>100 chars) fails', () => {
    const result = authSchema.safeParse({
      action: 'register',
      email: 'new@example.com',
      password: 'password123',
      name: 'A'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('Unknown action value fails', () => {
    const result = authSchema.safeParse({
      action: 'delete',
      email: 'user@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('Empty action fails', () => {
    const result = authSchema.safeParse({
      action: '',
      email: 'user@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });
});
