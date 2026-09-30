import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from '@/lib/auth';
import { logger } from '@/lib/logger';

// ─── Prisma Error Detection ───

/**
 * Detect Prisma client errors by their shape.
 * Prisma errors have a `code` property like 'P2021', 'P2002', etc.
 * We detect them duck-typing rather than importing @prisma/client/runtime
 * to keep this module decoupled from Prisma internals.
 */
interface PrismaLikeError {
  code: string;
  meta?: Record<string, unknown>;
  clientVersion?: string;
}

function isPrismaError(error: unknown): error is Error & PrismaLikeError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as PrismaLikeError).code === 'string' &&
    ((error as PrismaLikeError).code as string).startsWith('P')
  );
}

// ─── ApiError ───

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  requestId?: string;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
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
        ...(this.requestId && { requestId: this.requestId }),
      },
    };
  }

  static fromZodError(zodError: ZodError, requestId?: string): ApiError {
    // Zod v4: issues is a non-enumerable getter, access via type assertion
    const issues = (zodError as unknown as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    const details = (issues || []).map((err) => ({
      path: Array.isArray(err.path) ? err.path.join('.') : String(err.path),
      message: err.message,
    }));
    return new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', details, requestId);
  }
}

// ─── Error Handler ───

export function handleApiError(error: unknown, requestId?: string): NextResponse {
  const isProduction = process.env.NODE_ENV === 'production';

  // AuthError — map to structured response
  if (error instanceof AuthError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: error.message,
          ...(requestId && { requestId }),
        },
      },
      { status: error.statusCode }
    );
  }

  // ApiError — use its own toJSON
  if (error instanceof ApiError) {
    // Attach requestId if not already set and one was provided
    if (requestId && !error.requestId) {
      error.requestId = requestId;
    }
    return NextResponse.json(error.toJSON(), { status: error.statusCode });
  }

  // Prisma errors — handle specific codes with clean responses
  if (isPrismaError(error)) {
    const prismaCode = error.code;

    // P2021: Record not found → 404
    if (prismaCode === 'P2021') {
      logger.warn('Prisma: record not found', { prismaCode, requestId });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'The requested resource was not found',
            ...(requestId && { requestId }),
          },
        },
        { status: 404 }
      );
    }

    // P2002: Unique constraint violation → 409
    if (prismaCode === 'P2002') {
      // Extract target fields from meta (if available) — never in production
      const targetFields = !isProduction && error.meta?.target
        ? (error.meta.target as string[]).join(', ')
        : undefined;

      logger.warn('Prisma: unique constraint violation', {
        prismaCode,
        target: error.meta?.target,
        requestId,
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'CONFLICT',
            message: targetFields
              ? `A record with this ${targetFields} already exists`
              : 'A record with these values already exists',
            ...(requestId && { requestId }),
          },
        },
        { status: 409 }
      );
    }

    // P2025: Record not found (on update/delete) → 404
    if (prismaCode === 'P2025') {
      logger.warn('Prisma: record not found on operation', { prismaCode, requestId });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'The requested resource was not found',
            ...(requestId && { requestId }),
          },
        },
        { status: 404 }
      );
    }

    // Other Prisma errors → 500 (sanitized — never expose Prisma internals in production)
    logger.error('Prisma error', {
      prismaCode,
      errorMessage: isProduction ? '[sanitized]' : error.message,
      requestId,
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An internal error occurred',
          ...(requestId && { requestId }),
        },
      },
      { status: 500 }
    );
  }

  // ZodError — validation failure (shouldn't reach here normally, but handle it)
  if (error instanceof ZodError) {
    const apiError = ApiError.fromZodError(error, requestId);
    return NextResponse.json(apiError.toJSON(), { status: 422 });
  }

  // Unknown errors — never expose internal details in production
  logger.error('Unhandled API error', {
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    errorMessage: isProduction ? '[sanitized]' : (error instanceof Error ? error.message : 'unknown'),
    requestId,
  });

  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred',
        ...(requestId && { requestId }),
      },
    },
    { status: 500 }
  );
}
