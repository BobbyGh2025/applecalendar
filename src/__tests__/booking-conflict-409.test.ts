import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockJson } = vi.hoisted(() => ({ mockJson: vi.fn() }));

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

vi.mock('@/lib/db', () => ({ db: {} }));

describe('409 CONFLICT — booking conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CONFLICT error for sold-out tickets returns 409 and correct code', async () => {
    const { ApiError } = await import('@/lib/errors');
    const err = new ApiError(
      409,
      'TICKETS_SOLD_OUT',
      'Not enough tickets available. They may have been claimed by another user.'
    );
    mockJson.mockReturnValue({ status: 409 });
    const response = err.toResponse();
    const body = mockJson.mock.calls[0][0] as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TICKETS_SOLD_OUT');
    expect(body.error.message).toContain('tickets');
    expect(response.status).toBe(409);
  });

  it('CONFLICT error for duplicate registration returns 409', async () => {
    const { ApiError } = await import('@/lib/errors');
    const err = new ApiError(409, 'CONFLICT', 'Email already registered');
    mockJson.mockReturnValue({ status: 409 });
    err.toResponse();
    const body = mockJson.mock.calls[0][0] as { success: boolean; error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });

  it('Zod VALIDATION_ERROR for booking is 422 not 409', async () => {
    const { ApiError } = await import('@/lib/errors');
    const { z } = await import('zod');
    const schema = z.object({ ticketTypeId: z.string().min(1), quantity: z.number().int().min(1) });
    const result = schema.safeParse({ ticketTypeId: '', quantity: 0 });
    const apiErr = ApiError.fromZodError(result.error!);
    expect(apiErr.statusCode).toBe(422);
    expect(apiErr.code).toBe('VALIDATION_ERROR');
  });
});
