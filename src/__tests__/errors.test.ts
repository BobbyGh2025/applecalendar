import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError, z } from 'zod';

// Use vi.hoisted so the mock factory can reference these after hoisting
const { mockJson, MockAuthError } = vi.hoisted(() => {
  const mockJson = vi.fn();
  const MockAuthError = class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number = 401) {
      super(message);
      this.statusCode = statusCode;
    }
  };
  return { mockJson, MockAuthError };
});

vi.mock('next/server', () => ({
  NextResponse: { json: mockJson },
}));

vi.mock('@/lib/auth', () => ({
  AuthError: MockAuthError,
}));

import { ApiError, handleApiError } from '@/lib/errors';
import { AuthError } from '@/lib/auth';

describe('ApiError', () => {
  it('constructor sets statusCode, code, message, details', () => {
    const err = new ApiError(400, 'BAD_REQUEST', 'Something went wrong', { field: 'email' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toBe('Something went wrong');
    expect(err.details).toEqual({ field: 'email' });
  });

  it('toJSON() returns correct structure with success: false', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'Resource not found');
    const json = err.toJSON();
    expect(json).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
      },
    });
  });

  it('toJSON() includes details when provided', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', [
      { path: 'email', message: 'Invalid email' },
    ]);
    const json = err.toJSON();
    expect(json.success).toBe(false);
    expect(json.error.details).toEqual([{ path: 'email', message: 'Invalid email' }]);
  });

  it('toResponse() returns a NextResponse-like object (test JSON content and status)', () => {
    mockJson.mockReturnValue({ status: 429 });
    const err = new ApiError(429, 'RATE_LIMITED', 'Too many requests', { remaining: 0 });
    const response = err.toResponse();
    expect(mockJson).toHaveBeenCalledWith(
      {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          details: { remaining: 0 },
        },
      },
      { status: 429 },
    );
    expect(response.status).toBe(429);
  });

  it('fromZodError() creates a 422 error from Zod validation error', () => {
    const schema = z.object({ name: z.string().min(1) });
    const result = schema.safeParse({ name: '' });
    const zodError = result.error!;
    const apiErr = ApiError.fromZodError(zodError);
    expect(apiErr).toBeInstanceOf(ApiError);
    expect(apiErr.statusCode).toBe(422);
    expect(apiErr.code).toBe('VALIDATION_ERROR');
    expect(apiErr.message).toBe('Validation failed');
    expect(Array.isArray(apiErr.details)).toBe(true);
    expect(apiErr.details!.length).toBeGreaterThan(0);
  });
});

describe('handleApiError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJson.mockReturnValue({ status: 500 });
  });

  it('with AuthError returns 401', () => {
    mockJson.mockReturnValue({ status: 401 });
    const authErr = new AuthError('Not authenticated');
    const response = handleApiError(authErr);
    expect(mockJson).toHaveBeenCalledWith(
      { success: false, error: { code: 'AUTH_ERROR', message: 'Not authenticated' } },
      { status: 401 },
    );
  });

  it('with ApiError returns its status', () => {
    mockJson.mockReturnValue({ status: 404 });
    const apiErr = new ApiError(404, 'NOT_FOUND', 'Gone');
    const response = handleApiError(apiErr);
    expect(mockJson).toHaveBeenCalledWith(
      { success: false, error: { code: 'NOT_FOUND', message: 'Gone' } },
      { status: 404 },
    );
  });

  it('with unknown error returns 500', () => {
    const response = handleApiError(new Error('boom'));
    expect(mockJson).toHaveBeenCalledWith(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } },
      { status: 500 },
    );
  });

  it('never exposes stack traces (the message should be generic)', () => {
    const response = handleApiError(new Error('secret database password: xyz'));
    const callArgs = mockJson.mock.calls[0];
    const body = callArgs[0];
    expect(body.error.message).toBe('An internal error occurred');
    expect(body.error.message).not.toContain('secret');
    expect(body.error.message).not.toContain('xyz');
  });
});
