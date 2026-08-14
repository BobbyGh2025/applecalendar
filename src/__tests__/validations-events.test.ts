import { describe, it, expect } from 'vitest';
import { createEventSchema, updateEventSchema, eventQuerySchema } from '@/lib/validations/events';

const futureDate = '2030-01-15';
const laterDate = '2030-01-20';

const validMinimalEvent = {
  title: 'Test Event',
  description: 'A great event description',
  startDate: futureDate,
  venueName: 'Test Venue',
};

describe('createEventSchema', () => {
  it('Valid minimal event passes (required fields only)', () => {
    const result = createEventSchema.safeParse(validMinimalEvent);
    expect(result.success).toBe(true);
  });

  it('Missing title fails', () => {
    const result = createEventSchema.safeParse({
      ...validMinimalEvent,
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('Title too long fails', () => {
    const result = createEventSchema.safeParse({
      ...validMinimalEvent,
      title: 'A'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('Missing description fails', () => {
    const { description: _, ...rest } = validMinimalEvent;
    const result = createEventSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('Description too short fails', () => {
    const result = createEventSchema.safeParse({
      ...validMinimalEvent,
      description: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('isVirtual=true without virtualUrl passes (it is optional)', () => {
    const result = createEventSchema.safeParse({
      title: 'Virtual Event',
      description: 'A virtual event description here',
      startDate: futureDate,
      isVirtual: true,
    });
    expect(result.success).toBe(true);
  });

  it('isVirtual=false without venueName fails', () => {
    const result = createEventSchema.safeParse({
      title: 'In-Person Event',
      description: 'An in-person event description here',
      startDate: futureDate,
      isVirtual: false,
    });
    expect(result.success).toBe(false);
  });

  it('endDate before startDate fails (use superRefine validation)', () => {
    const result = createEventSchema.safeParse({
      ...validMinimalEvent,
      startDate: '2030-01-20',
      endDate: '2030-01-15',
    });
    expect(result.success).toBe(false);
  });

  it('Invalid ticket type (minPerOrder > maxPerOrder) fails', () => {
    const result = createEventSchema.safeParse({
      ...validMinimalEvent,
      isVirtual: true,
      ticketTypes: [
        {
          name: 'VIP',
          price: 100,
          quantity: 50,
          minPerOrder: 5,
          maxPerOrder: 2,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('Valid ticket types pass', () => {
    const result = createEventSchema.safeParse({
      ...validMinimalEvent,
      isVirtual: true,
      ticketTypes: [
        {
          name: 'General',
          price: 10,
          quantity: 100,
          minPerOrder: 1,
          maxPerOrder: 5,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('Invalid latitude/longitude fails', () => {
    const result = createEventSchema.safeParse({
      ...validMinimalEvent,
      venueLat: 100,
      venueLng: 200,
    });
    expect(result.success).toBe(false);
  });

  it('Invalid time format fails', () => {
    const result = createEventSchema.safeParse({
      ...validMinimalEvent,
      startTime: '25:00',
    });
    expect(result.success).toBe(false);
  });
});

describe('eventQuerySchema', () => {
  it('Valid query with all params', () => {
    const result = eventQuerySchema.safeParse({
      page: '2',
      limit: '10',
      search: 'music',
      category: 'concerts',
      featured: 'true',
      status: 'PUBLISHED',
    });
    expect(result.success).toBe(true);
    const data = result.data!;
    expect(data.page).toBe(2);
    expect(data.limit).toBe(10);
    expect(data.featured).toBe(true);
    expect(data.status).toBe('PUBLISHED');
  });

  it('Default values applied (page=1, limit=12)', () => {
    const result = eventQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data!.page).toBe(1);
    expect(result.data!.limit).toBe(12);
  });

  it('page=0 is rejected (below min 1)', () => {
    const result = eventQuerySchema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });

  it('limit=200 is clamped to 100', () => {
    const result = eventQuerySchema.safeParse({ limit: '200' });
    expect(result.success).toBe(false);
  });

  it('featured="true" is transformed to boolean true', () => {
    const result = eventQuerySchema.safeParse({ featured: 'true' });
    expect(result.success).toBe(true);
    expect(result.data!.featured).toBe(true);
  });

  it('Invalid status rejected', () => {
    const result = eventQuerySchema.safeParse({ status: 'INVALID' });
    expect(result.success).toBe(false);
  });
});

describe('updateEventSchema', () => {
  it('Empty object passes (all optional)', () => {
    const result = updateEventSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('Invalid fields rejected (e.g., status not in enum)', () => {
    const result = updateEventSchema.safeParse({ status: 'INVALID' });
    expect(result.success).toBe(false);
  });
});
