import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from '@/lib/auth';

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }

  toResponse(): NextResponse {
    return NextResponse.json(this.toJSON(), { status: this.statusCode });
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }

  static fromZodError(zodError: ZodError): ApiError {
    // Zod v4: issues is a non-enumerable getter, access via type assertion
    const issues = (zodError as unknown as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    const details = (issues || []).map((err) => ({
      path: Array.isArray(err.path) ? err.path.join('.') : String(err.path),
      message: err.message,
    }));
    return new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', details);
  }
}

export function handleApiError(error: unknown): NextResponse {
  const isProduction = process.env.NODE_ENV === 'production';

  if (error instanceof AuthError) {
    return NextResponse.json(
      { success: false, error: { code: 'AUTH_ERROR', message: error.message } },
      { status: error.statusCode }
    );
  }

  if (error instanceof ApiError) {
    return NextResponse.json(error.toJSON(), { status: error.statusCode });
  }

  // Unknown errors — never expose internal details in production
  console.error('Unhandled API error:', error);
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction
          ? 'An internal error occurred'
          : 'An internal error occurred',
      },
    },
    { status: 500 }
  );
}
