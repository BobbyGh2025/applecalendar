/**
 * Shared slugify utility.
 *
 * Converts a string to a URL-safe slug:
 * - Lowercase
 * - Replace non-word chars with empty
 * - Replace spaces/underscores with hyphens
 * - Trim leading/trailing hyphens
 *
 * Used by Event, Venue, and other models that need URL-safe slugs.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
