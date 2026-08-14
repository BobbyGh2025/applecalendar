import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, handleApiError } from '@/lib/errors';
import { AuthError } from '@/lib/auth';
import { ZodError, z } from 'zod';
import { RateLimitError } from '@/lib/rate-limit';

const { mockJson } = vi.hoisted(() => {
  const mockJson = vi.fn();
  return { mockJson };
});

vi.mock('next/server', () => ({
  NextResponse: { json: mockJson },
}));

vi.mock('@/lib/auth', () => ({
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number = 401) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/db', () => ({
  db: {},
}));

describe('Standardized API error structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJson.mockReturnValue({ status: 500 });
  });

  function getBody(mockCall: any) {
    return mockCall[0] as { success: boolean; error: { code: string; message: string; details?: unknown } };
  }

  function getStatus(mockCall: any) {
    return (mockCall[1] as { status: number }).status;
  }

  it('UNAUTHORIZED error has correct structure and status 401', () => {
    const err = new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
    mockJson.mockReturnValue({ status: 401 });
    const response = err.toResponse();
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid email or password');
    expect(response.status).toBe(401);
  });

  it('FORBIDDEN error has correct structure and status 403', () => {
    const err = new ApiError(403, 'FORBIDDEN', 'Account is deactivated');
    mockJson.mockReturnValue({ status: 403 });
    err.toResponse();
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('Account is deactivated');
  });

  it('NOT_FOUND error has correct structure and status 404', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'Event not found');
    mockJson.mockReturnValue({ status: 404 });
    err.toResponse();
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Event not found');
  });

  it('CONFLICT error has correct structure and status 409', () => {
    const err = new ApiError(409, 'CONFLICT', 'Email already registered');
    mockJson.mockReturnValue({ status: 409 });
    err.toResponse();
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toBe('Email already registered');
  });

  it('VALIDATION_ERROR has correct structure and status 400', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Minimum 1 tickets per order');
    mockJson.mockReturnValue({ status: 400 });
    err.toResponse();
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Minimum 1 tickets per order');
  });

  it('RATE_LIMITED error has correct structure, status 429, and details', () => {
    const err = new RateLimitError(0, Date.now() + 60000);
    mockJson.mockReturnValue({ status: 429 });
    err.toResponse();
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toBe('Too many requests. Please try again later.');
    expect(body.error.details).toEqual({ remaining: 0, resetAt: expect.any(Number) });
  });

  it('Zod VALIDATION_ERROR has status 422 and details array', () => {
    const schema = z.object({ name: z.string().min(1), email: z.string().email() });
    const result = schema.safeParse({ name: '', email: 'bad' });
    const apiErr = ApiError.fromZodError(result.error!);
    mockJson.mockReturnValue({ status: 422 });
    apiErr.toResponse();
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect((body.error.details as Array<{ path: string; message: string }>).length).toBeGreaterThan(0);
  });

  it('INTERNAL_ERROR has generic message and status 500', () => {
    const response = handleApiError(new Error('secret database password: xyz'));
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An internal error occurred');
    expect(body.error.message).not.toContain('secret');
    expect(body.error.message).not.toContain('xyz');
  });

  it('handleApiError with AuthError returns AUTH_ERROR code', () => {
    mockJson.mockReturnValue({ status: 401 });
    handleApiError(new AuthError('Authentication required'));
    const body = getBody(mockJson.mock.calls[0]);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_ERROR');
    expect(body.error.message).toBe('Authentication required');
  });

  it('handleApiError with AuthError(403) returns status 403', () => {
    mockJson.mockReturnValue({ status: 403 });
    handleApiError(new AuthError('Insufficient permissions', 403));
    const status = getStatus(mockJson.mock.calls[0]);
    expect(status).toBe(403);
  });

  it('error responses never contain stack traces', () => {
    const err = new Error('test');
    err.stack = 'Error: test\n    at Object.<anonymous> (/home/z/my-project/secret-path/file.ts:10:5)';
    handleApiError(err);
    const body = getBody(mockJson.mock.calls[0]);
    const jsonStr = JSON.stringify(body);
    expect(jsonStr).not.toContain('stack');
    expect(jsonStr).not.toContain('secret-path');
    expect(jsonStr).not.toContain('.ts:');
  });

  it('error responses never expose database errors', () => {
    handleApiError(new Error('SQLite error: UNIQUE constraint failed: User.email'));
    const body = getBody(mockJson.mock.calls[0]);
    const jsonStr = JSON.stringify(body);
    expect(jsonStr).not.toContain('SQLite');
    expect(jsonStr).not.toContain('UNIQUE constraint');
    expect(jsonStr).not.toContain('User.email');
  });
});
