/**
 * Phase 5D: Database Client — Production-Ready
 *
 * Singleton pattern prevents hot-reload connection leaks in development.
 * Query logging enabled only in development mode.
 *
 * Production deployment:
 *   DATABASE_URL=postgresql://user:pass@host:5432/db
 *   prisma migrate deploy   ← Use this (NOT db:push)
 *   application startup
 *
 * Connection pooling (PostgreSQL):
 *   Prisma uses a built-in connection pool. Default: num_cpus * 2 + 1
 *   For custom config, add to DATABASE_URL:
 *     ?connection_limit=10&pool_timeout=30
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query'] : [],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

/**
 * Gracefully disconnect the database client.
 * Call this on process shutdown (SIGTERM/SIGINT).
 */
export async function gracefulDisconnect(): Promise<void> {
  await db.$disconnect();
}
