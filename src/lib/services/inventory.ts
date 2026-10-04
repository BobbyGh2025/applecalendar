/**
 * Phase 5E Stage 2: Inventory Reservation Service
 *
 * Centralized service for managing ticket inventory reservations.
 *
 * Invariant: soldCount + reservedCount <= quantity  (ALWAYS)
 *
 * For paid bookings (payment pending):
 *   1. Reserve inventory (reservedCount += quantity) at payment initialization
 *   2. On payment success: confirm reservation (reservedCount -= qty, soldCount += qty)
 *   3. On payment failure/expire/cancel: release reservation (reservedCount -= qty)
 *
 * For free bookings (no payment needed):
 *   soldCount += quantity immediately (no reservation needed)
 *
 * Uses raw SQL conditional updates to prevent race conditions.
 * Two concurrent reservations for the last ticket cannot both succeed.
 */

import { db } from '@/lib/db';
import { InsufficientInventory, InventoryInvariantViolation } from './payment-domain-errors';
import { validateTicketTypeInventoryConstraints } from '@/lib/money-constraints';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface ReserveInventoryParams {
  ticketTypeId: string;
  quantity: number;
  /** Prisma transaction client (if part of a larger transaction) */
  tx?: PrismaTransaction;
}

export interface ReleaseInventoryParams {
  ticketTypeId: string;
  quantity: number;
  tx?: PrismaTransaction;
}

export interface ConfirmReservationParams {
  ticketTypeId: string;
  quantity: number;
  tx?: PrismaTransaction;
}

export interface InventoryCheckResult {
  ticketTypeId: string;
  quantity: number;
  soldCount: number;
  reservedCount: number;
  available: number;
  canReserve: boolean;
}

/** Prisma transaction client type */
export type PrismaTransaction = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// ─── Core: Check Inventory ───

/**
 * Check current inventory status for a ticket type.
 * This is a READ operation — does not modify data.
 */
export async function checkInventory(
  ticketTypeId: string,
  tx?: PrismaTransaction,
): Promise<InventoryCheckResult> {
  const client = tx ?? db;
  const ticketType = await client.ticketType.findUnique({
    where: { id: ticketTypeId },
    select: { id: true, quantity: true, soldCount: true, reservedCount: true },
  });

  if (!ticketType) {
    throw new InsufficientInventory(ticketTypeId, 0, 0);
  }

  const available = ticketType.quantity - ticketType.soldCount - ticketType.reservedCount;
  return {
    ticketTypeId: ticketType.id,
    quantity: ticketType.quantity,
    soldCount: ticketType.soldCount,
    reservedCount: ticketType.reservedCount,
    available: Math.max(0, available),
    canReserve: available > 0,
  };
}

// ─── Core: Reserve Inventory ───

/**
 * Reserve inventory for a pending payment.
 * Atomically increments reservedCount only if enough inventory exists.
 *
 * Uses raw SQL conditional update to prevent overselling:
 *   WHERE id = ticketTypeId AND (quantity - soldCount - reservedCount) >= requestedQty
 *   SET reservedCount = reservedCount + requestedQty
 *
 * @throws InsufficientInventory if not enough tickets available
 */
export async function reserveInventory(params: ReserveInventoryParams): Promise<void> {
  const { ticketTypeId, quantity, tx } = params;
  const client = tx ?? db;

  if (quantity <= 0) return; // No-op for zero quantity

  // Atomic conditional update using raw SQL:
  // Only increment reservedCount if (quantity - soldCount - reservedCount) >= requestedQty
  const updateCount = await client.$executeRaw`
    UPDATE "TicketType"
    SET "reservedCount" = "reservedCount" + ${quantity}
    WHERE "id" = ${ticketTypeId}
      AND ("quantity" - "soldCount" - "reservedCount") >= ${quantity}
  `;

  if (updateCount === 0) {
    // Check why: either not found, or insufficient inventory
    const tt = await client.ticketType.findUnique({
      where: { id: ticketTypeId },
      select: { quantity: true, soldCount: true, reservedCount: true },
    });

    if (!tt) {
      throw new InsufficientInventory(ticketTypeId, quantity, 0);
    }

    const available = tt.quantity - tt.soldCount - tt.reservedCount;
    throw new InsufficientInventory(ticketTypeId, quantity, available);
  }

  logger.info('Inventory reserved', { ticketTypeId, quantity });
}

// ─── Core: Release Reservation ───

/**
 * Release a reservation (e.g., payment failed, expired, or cancelled).
 * Atomically decrements reservedCount with a safety guard to prevent going below 0.
 */
export async function releaseReservation(params: ReleaseInventoryParams): Promise<void> {
  const { ticketTypeId, quantity, tx } = params;
  const client = tx ?? db;

  if (quantity <= 0) return; // No-op for zero quantity

  // Atomic conditional decrement: only decrement if reservedCount >= quantity
  const result = await client.ticketType.updateMany({
    where: {
      id: ticketTypeId,
      reservedCount: { gte: quantity },
    },
    data: {
      reservedCount: { decrement: quantity },
    },
  });

  if (result.count === 0) {
    // Safety: if the guard prevented decrement, force reservedCount to 0 (data repair)
    logger.warn('Reservation release guard triggered — forcing reservedCount to 0', {
      ticketTypeId,
      quantity,
    });
    await client.ticketType.update({
      where: { id: ticketTypeId },
      data: { reservedCount: 0 },
    });
  }

  logger.info('Reservation released', { ticketTypeId, quantity });
}

// ─── Core: Confirm Reservation (payment success) ───

/**
 * Confirm a reservation after successful payment.
 * Atomically moves inventory from reserved to sold:
 *   reservedCount -= quantity
 *   soldCount += quantity
 *
 * Uses raw SQL for atomicity of the compound update.
 * Includes safety guard: reservedCount must be >= quantity.
 */
export async function confirmReservation(params: ConfirmReservationParams): Promise<void> {
  const { ticketTypeId, quantity, tx } = params;
  const client = tx ?? db;

  if (quantity <= 0) return; // No-op for zero quantity

  // Atomic compound update with guard
  const updateCount = await client.$executeRaw`
    UPDATE "TicketType"
    SET
      "reservedCount" = "reservedCount" - ${quantity},
      "soldCount" = "soldCount" + ${quantity}
    WHERE "id" = ${ticketTypeId}
      AND "reservedCount" >= ${quantity}
  `;

  if (updateCount === 0) {
    // The reservation might already be confirmed (idempotent), or data issue
    const tt = await client.ticketType.findUnique({
      where: { id: ticketTypeId },
      select: { quantity: true, soldCount: true, reservedCount: true },
    });

    if (!tt) {
      throw new InventoryInvariantViolation(ticketTypeId, 0, 0, 0);
    }

    // If reservedCount < quantity, the reservation was already confirmed (idempotent case)
    // Check invariant: soldCount + reservedCount <= quantity
    if (tt.soldCount + tt.reservedCount <= tt.quantity) {
      // Invariant holds — likely already confirmed, not an error
      logger.info('Reservation already confirmed (idempotent)', { ticketTypeId, quantity });
      return;
    }

    // Invariant violated
    throw new InventoryInvariantViolation(ticketTypeId, tt.soldCount, tt.reservedCount, tt.quantity);
  }

  logger.info('Reservation confirmed (reserved→sold)', { ticketTypeId, quantity });
}

// ─── Core: Direct Sold Increment (free bookings) ───

/**
 * Directly increment soldCount for free bookings (no reservation needed).
 * Atomic conditional update to prevent overselling.
 */
export async function directSoldIncrement(
  ticketTypeId: string,
  quantity: number,
  tx?: PrismaTransaction,
): Promise<void> {
  const client = tx ?? db;

  if (quantity <= 0) return;

  // Use raw SQL for the compound condition
  const updateCount = await client.$executeRaw`
    UPDATE "TicketType"
    SET "soldCount" = "soldCount" + ${quantity}
    WHERE "id" = ${ticketTypeId}
      AND ("quantity" - "soldCount" - "reservedCount") >= ${quantity}
  `;

  if (updateCount === 0) {
    const tt = await client.ticketType.findUnique({
      where: { id: ticketTypeId },
      select: { quantity: true, soldCount: true, reservedCount: true },
    });

    const available = tt ? tt.quantity - tt.soldCount - tt.reservedCount : 0;
    throw new InsufficientInventory(ticketTypeId, quantity, available);
  }

  logger.info('Sold count incremented directly (free booking)', { ticketTypeId, quantity });
}

// ─── Core: Restore Sold Count (cancellation of confirmed booking) ───

/**
 * Decrement soldCount when a confirmed booking is cancelled.
 * Atomic with safety guard: soldCount >= quantity.
 */
export async function restoreSoldCount(
  ticketTypeId: string,
  quantity: number,
  tx?: PrismaTransaction,
): Promise<void> {
  const client = tx ?? db;

  if (quantity <= 0) return;

  const result = await client.ticketType.updateMany({
    where: {
      id: ticketTypeId,
      soldCount: { gte: quantity },
    },
    data: {
      soldCount: { decrement: quantity },
    },
  });

  if (result.count === 0) {
    // Safety: force soldCount to not go below 0
    logger.warn('SoldCount decrement guard triggered — forcing soldCount to 0', {
      ticketTypeId,
      quantity,
    });
    await client.ticketType.update({
      where: { id: ticketTypeId },
      data: { soldCount: 0 },
    });
  }

  logger.info('Sold count restored (cancellation)', { ticketTypeId, quantity });
}

// ─── Verify Invariant ───

/**
 * Verify the inventory invariant holds for a ticket type.
 * Throws if soldCount + reservedCount > quantity.
 */
export async function verifyInventoryInvariant(
  ticketTypeId: string,
  tx?: PrismaTransaction,
): Promise<boolean> {
  const client = tx ?? db;
  const tt = await client.ticketType.findUnique({
    where: { id: ticketTypeId },
    select: { quantity: true, soldCount: true, reservedCount: true },
  });

  if (!tt) return false;

  validateTicketTypeInventoryConstraints({
    quantity: tt.quantity,
    soldCount: tt.soldCount,
    reservedCount: tt.reservedCount,
  });

  return true;
}
