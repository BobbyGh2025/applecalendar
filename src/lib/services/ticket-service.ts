/**
 * Phase 5E Stage 2: Ticket Issuance Service
 *
 * Central service for creating and managing tickets across the booking lifecycle.
 *
 * Critical invariant:
 *   An unpaid paid booking must NEVER produce a VALID ticket.
 *
 * Lifecycle:
 *   - Create tickets in PENDING state for unpaid/pending bookings
 *   - Transition tickets to VALID only after confirmed payment
 *   - Support cancellation/expiry of PENDING tickets
 *   - Generate QR codes only at the appropriate lifecycle point
 *
 * Idempotency:
 *   - If the same payment-success operation is processed twice,
 *     duplicate tickets must NOT be created.
 *   - Uses bookingId + ticketTypeId + existing ticket count to ensure
 *     correct number of tickets exist.
 */

import crypto from 'crypto';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

// ─── Types ───

export interface CreatePendingTicketsParams {
  bookingId: string;
  ticketTypeId: string;
  quantity: number;
  bookingRef: string;
  /** Prisma transaction client */
  tx?: PrismaTransaction;
}

export interface ActivateTicketsParams {
  bookingId: string;
  tx?: PrismaTransaction;
}

export interface CancelTicketsParams {
  bookingId: string;
  tx?: PrismaTransaction;
}

export interface ExpireTicketsParams {
  bookingId: string;
  tx?: PrismaTransaction;
}

type PrismaTransaction = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// ─── QR Code Generation ───

/**
 * Generate a cryptographically secure QR code for a ticket.
 * Format: QR-{bookingRef}-{randomHex}
 */
function generateQrCode(bookingRef: string): string {
  const random = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `QR-${bookingRef}-${random}`;
}

// ─── Core: Create Pending Tickets ───

/**
 * Create tickets in PENDING state for a booking that has not yet been paid.
 *
 * This is used when a paid booking is first created — tickets should
 * NOT be VALID until payment is confirmed.
 *
 * Idempotency: If tickets already exist for this booking+ticketType
 * with the expected count, no additional tickets are created.
 */
export async function createPendingTickets(
  params: CreatePendingTicketsParams,
): Promise<{ ticketIds: string[]; created: number }> {
  const { bookingId, ticketTypeId, quantity, bookingRef, tx } = params;
  const client = tx ?? db;

  // Check how many tickets already exist for this booking+ticketType
  const existingCount = await client.ticket.count({
    where: { bookingId, ticketTypeId },
  });

  if (existingCount >= quantity) {
    // Idempotent: tickets already exist
    logger.info('Tickets already exist for booking (idempotent)', {
      bookingId,
      ticketTypeId,
      existingCount,
      requested: quantity,
    });
    const existing = await client.ticket.findMany({
      where: { bookingId, ticketTypeId },
      select: { id: true },
      take: quantity,
    });
    return { ticketIds: existing.map(t => t.id), created: 0 };
  }

  // Create the missing tickets
  const toCreate = quantity - existingCount;
  const ticketIds: string[] = [];

  // Get existing tickets' IDs
  const existingTickets = await client.ticket.findMany({
    where: { bookingId, ticketTypeId },
    select: { id: true },
  });
  ticketIds.push(...existingTickets.map(t => t.id));

  for (let i = 0; i < toCreate; i++) {
    const qrCode = generateQrCode(bookingRef);
    const ticket = await client.ticket.create({
      data: {
        ticketTypeId,
        bookingId,
        qrCode,
        status: 'PENDING',
      },
      select: { id: true },
    });
    ticketIds.push(ticket.id);
  }

  logger.info('Pending tickets created', {
    bookingId,
    ticketTypeId,
    created: toCreate,
    total: ticketIds.length,
  });

  return { ticketIds, created: toCreate };
}

// ─── Core: Activate Tickets (payment success) ───

/**
 * Transition PENDING tickets to VALID after payment confirmation.
 *
 * Idempotent: If tickets are already VALID, they remain VALID.
 * Uses conditional updateMany to prevent double-activation.
 */
export async function activateTickets(
  params: ActivateTicketsParams,
): Promise<{ activated: number }> {
  const { bookingId, tx } = params;
  const client = tx ?? db;

  // Only transition PENDING tickets — VALID/USED tickets are unchanged
  const result = await client.ticket.updateMany({
    where: {
      bookingId,
      status: 'PENDING',
    },
    data: {
      status: 'VALID',
    },
  });

  logger.info('Tickets activated', { bookingId, activated: result.count });
  return { activated: result.count };
}

// ─── Core: Cancel Tickets ───

/**
 * Cancel tickets for a cancelled booking.
 * Both PENDING and VALID tickets are cancelled.
 * USED tickets are NOT cancelled (they've already been consumed).
 */
export async function cancelTickets(
  params: CancelTicketsParams,
): Promise<{ cancelled: number }> {
  const { bookingId, tx } = params;
  const client = tx ?? db;

  const result = await client.ticket.updateMany({
    where: {
      bookingId,
      status: { in: ['PENDING', 'VALID'] },
    },
    data: {
      status: 'CANCELLED',
    },
  });

  logger.info('Tickets cancelled', { bookingId, cancelled: result.count });
  return { cancelled: result.count };
}

// ─── Core: Expire Tickets ───

/**
 * Expire PENDING tickets for an expired booking/payment.
 * VALID tickets are NOT expired (they represent confirmed purchases).
 */
export async function expireTickets(
  params: ExpireTicketsParams,
): Promise<{ expired: number }> {
  const { bookingId, tx } = params;
  const client = tx ?? db;

  const result = await client.ticket.updateMany({
    where: {
      bookingId,
      status: 'PENDING',
    },
    data: {
      status: 'EXPIRED',
    },
  });

  logger.info('Tickets expired', { bookingId, expired: result.count });
  return { expired: result.count };
}

// ─── Query: Get Tickets for Booking ───

/**
 * Get all tickets for a booking with their statuses.
 */
export async function getTicketsForBooking(bookingId: string): Promise<
  Array<{
    id: string;
    qrCode: string;
    status: string;
    ticketTypeId: string;
    checkedInAt: Date | null;
  }>
> {
  return db.ticket.findMany({
    where: { bookingId },
    select: {
      id: true,
      qrCode: true,
      status: true,
      ticketTypeId: true,
      checkedInAt: true,
    },
  });
}

// ─── Query: Count Tickets by Status ───

/**
 * Count tickets by status for a booking.
 */
export async function countTicketsByStatus(
  bookingId: string,
): Promise<Record<string, number>> {
  const tickets = await db.ticket.findMany({
    where: { bookingId },
    select: { status: true },
  });

  const counts: Record<string, number> = {};
  for (const ticket of tickets) {
    counts[ticket.status] = (counts[ticket.status] ?? 0) + 1;
  }
  return counts;
}
