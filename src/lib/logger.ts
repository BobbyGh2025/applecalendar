/**
 * Phase 5D: Structured Logger
 *
 * Provides consistent, structured logging across the application.
 * - Production: JSON output for log aggregation (Datadog, CloudWatch, etc.)
 * - Development: Human-readable output
 * - Never logs secrets, tokens, or passwords
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Request processed', { requestId, method, path, duration });
 *   logger.error('Database error', { error, requestId });
 */

// ─── Types ───

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  service: string;
  context?: LogContext;
}

// ─── Sensitive Key Detection ───

const SENSITIVE_KEYS = new Set([
  'password', 'passwordHash', 'token', 'tokenHash', 'secret',
  'jwt', 'jwtSecret', 'accessToken', 'refreshToken',
  'authorization', 'cookie', 'sessionId',
  'creditCard', 'cardNumber', 'cvv',
  'apiKey', 'apiSecret', 'privateKey',
  'DATABASE_URL', 'JWT_SECRET',
]);

const SENSITIVE_PARTIAL_MATCHES = [
  'password', 'token', 'secret', 'key', 'hash', 'credential',
];

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_KEYS.has(key)) return true;
  const lower = key.toLowerCase();
  return SENSITIVE_PARTIAL_MATCHES.some(p => lower.includes(p));
}

function redactContext(context: LogContext): LogContext {
  const redacted: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      redacted[key] = redactContext(value as LogContext);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// ─── Format ───

function formatProduction(entry: LogEntry): string {
  return JSON.stringify({
    ...entry,
    context: entry.context ? redactContext(entry.context) : undefined,
  });
}

function formatDevelopment(entry: LogEntry): string {
  const { timestamp, level, message, context } = entry;
  const levelStr = level.toUpperCase().padEnd(5);
  const timeStr = timestamp.replace('T', ' ').replace(/\.\d{3}Z$/, '');

  if (!context || Object.keys(context).length === 0) {
    return `${timeStr} [${levelStr}] ${message}`;
  }

  const safeContext = redactContext(context);
  const contextStr = Object.entries(safeContext)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');

  return `${timeStr} [${levelStr}] ${message} | ${contextStr}`;
}

// ─── Logger ───

class Logger {
  private service: string;
  private isProduction: boolean;
  private defaultContext: LogContext;

  constructor(service: string = 'applecalendar', defaultContext: LogContext = {}) {
    this.service = service;
    this.isProduction = process.env.NODE_ENV === 'production';
    this.defaultContext = defaultContext;
  }

  private createEntry(level: LogEntry['level'], message: string, context?: LogContext): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
      context: { ...this.defaultContext, ...context },
    };
  }

  private write(entry: LogEntry) {
    const output = this.isProduction ? formatProduction(entry) : formatDevelopment(entry);
    switch (entry.level) {
      case 'error':
        process.stderr.write(output + '\n');
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
        break;
    }
  }

  debug(message: string, context?: LogContext) {
    if (this.isProduction) return; // Suppress debug in production
    this.write(this.createEntry('debug', message, context));
  }

  info(message: string, context?: LogContext) {
    this.write(this.createEntry('info', message, context));
  }

  warn(message: string, context?: LogContext) {
    this.write(this.createEntry('warn', message, context));
  }

  error(message: string, context?: LogContext) {
    this.write(this.createEntry('error', message, context));
  }

  /** Create a child logger with additional default context (e.g., requestId) */
  withContext(context: LogContext): Logger {
    return new Logger(this.service, { ...this.defaultContext, ...context });
  }
}

// ─── Export ───

export const logger = new Logger();

export { Logger };
