import { describe, it, expect } from 'vitest';
import { createAdSchema, updateAdSchema } from '@/lib/validations/ads';

describe('createAdSchema', () => {
  it('Valid minimal (title only) passes', () => {
    const result = createAdSchema.safeParse({
      title: 'My Ad',
    });
    expect(result.success).toBe(true);
    // Default position
    expect(result.data!.position).toBe('SIDEBAR');
  });

  it('Missing title fails', () => {
    const result = createAdSchema.safeParse({
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('Valid full ad with all fields passes', () => {
    const result = createAdSchema.safeParse({
      title: 'Big Banner',
      imageUrl: 'https://example.com/banner.png',
      linkUrl: 'https://example.com/landing',
      position: 'BANNER',
      startDate: '2030-01-01',
      endDate: '2030-02-01',
      eventId: 'event-123',
    });
    expect(result.success).toBe(true);
  });

  it('Invalid URL format for imageUrl fails', () => {
    const result = createAdSchema.safeParse({
      title: 'Bad URL Ad',
      imageUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('Invalid position fails', () => {
    const result = createAdSchema.safeParse({
      title: 'Bad Position Ad',
      position: 'HEADER',
    });
    expect(result.success).toBe(false);
  });

  it('startDate and endDate are parsed (no cross-field validation in schema)', () => {
    const result = createAdSchema.safeParse({
      title: 'Date Ad',
      startDate: '2030-02-01',
      endDate: '2030-01-01',
    });
    // The schema doesn't enforce date ordering, so this passes
    expect(result.success).toBe(true);
  });
});

describe('updateAdSchema', () => {
  it('Empty object passes', () => {
    const result = updateAdSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('Invalid status rejected', () => {
    const result = updateAdSchema.safeParse({ status: 'DELETED' });
    expect(result.success).toBe(false);
  });
});
