import { describe, it, expect } from 'vitest';
import { createBookingSchema } from '@/lib/validations/bookings';

describe('createBookingSchema', () => {
  it('Valid input passes', () => {
    const result = createBookingSchema.safeParse({
      ticketTypeId: 'ticket-123',
      quantity: 2,
    });
    expect(result.success).toBe(true);
  });

  it('Missing ticketTypeId fails', () => {
    const result = createBookingSchema.safeParse({
      ticketTypeId: '',
      quantity: 2,
    });
    expect(result.success).toBe(false);
  });

  it('Missing quantity fails', () => {
    const result = createBookingSchema.safeParse({
      ticketTypeId: 'ticket-123',
    });
    expect(result.success).toBe(false);
  });

  it('quantity=0 fails', () => {
    const result = createBookingSchema.safeParse({
      ticketTypeId: 'ticket-123',
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it('quantity=-1 fails', () => {
    const result = createBookingSchema.safeParse({
      ticketTypeId: 'ticket-123',
      quantity: -1,
    });
    expect(result.success).toBe(false);
  });

  it('quantity=101 fails (max 100)', () => {
    const result = createBookingSchema.safeParse({
      ticketTypeId: 'ticket-123',
      quantity: 101,
    });
    expect(result.success).toBe(false);
  });

  it('Extra fields are stripped', () => {
    const result = createBookingSchema.safeParse({
      ticketTypeId: 'ticket-123',
      quantity: 3,
      extraField: 'should be removed',
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).extraField).toBeUndefined();
  });
});
