import { z } from 'zod';
import {
  paginationSchema,
  emailField,
  urlField,
  optionalUrlField,
  latitudeField,
  longitudeField,
} from './common';

// ---- Create Venue ----

/**
 * Schema for creating a new venue (POST /api/organizer/venues).
 * Name and address are required; all other fields optional.
 */
export const createVenueSchema = z.object({
  name: z
    .string()
    .min(1, 'Venue name is required')
    .max(200, 'Venue name must be 200 characters or fewer'),
  description: z
    .string()
    .max(2000, 'Description must be 2000 characters or fewer')
    .optional(),
  address: z
    .string()
    .min(1, 'Address is required')
    .max(300, 'Address must be 300 characters or fewer'),
  city: z
    .string()
    .min(1, 'City is required')
    .max(100, 'City must be 100 characters or fewer'),
  state: z.string().max(100, 'State must be 100 characters or fewer').optional(),
  country: z.string().max(100, 'Country must be 100 characters or fewer').optional(),
  postalCode: z.string().max(20, 'Postal code must be 20 characters or fewer').optional(),
  lat: latitudeField.optional(),
  lng: longitudeField.optional(),
  googleMapsUrl: optionalUrlField,
  coverImage: optionalUrlField,
  capacity: z
    .number()
    .int('Capacity must be an integer')
    .positive('Capacity must be a positive number')
    .optional(),
  amenities: z
    .array(z.string().max(50, 'Amenity must be 50 characters or fewer'))
    .max(20, 'Maximum 20 amenities allowed')
    .optional(),
  contactName: z.string().max(200, 'Contact name must be 200 characters or fewer').optional(),
  contactEmail: z.union([emailField, z.literal('')]).optional(),
  contactPhone: z.string().max(50, 'Contact phone must be 50 characters or fewer').optional(),
  website: optionalUrlField,
  isPublic: z.boolean().optional(),
});

export type CreateVenueInput = z.infer<typeof createVenueSchema>;

// ---- Update Venue ----

/**
 * Schema for partially updating a venue (PATCH /api/organizer/venues/:id).
 * All fields are optional since it's a partial update.
 */
export const updateVenueSchema = z.object({
  name: z
    .string()
    .min(1, 'Venue name cannot be empty')
    .max(200, 'Venue name must be 200 characters or fewer')
    .optional(),
  description: z
    .string()
    .max(2000, 'Description must be 2000 characters or fewer')
    .optional(),
  address: z
    .string()
    .min(1, 'Address cannot be empty')
    .max(300, 'Address must be 300 characters or fewer')
    .optional(),
  city: z
    .string()
    .min(1, 'City cannot be empty')
    .max(100, 'City must be 100 characters or fewer')
    .optional(),
  state: z.string().max(100, 'State must be 100 characters or fewer').optional(),
  country: z.string().max(100, 'Country must be 100 characters or fewer').optional(),
  postalCode: z.string().max(20, 'Postal code must be 20 characters or fewer').optional(),
  lat: latitudeField.optional(),
  lng: longitudeField.optional(),
  googleMapsUrl: z.union([urlField, z.literal('')]).optional(),
  coverImage: z.union([urlField, z.literal('')]).optional(),
  capacity: z
    .number()
    .int('Capacity must be an integer')
    .positive('Capacity must be a positive number')
    .optional(),
  amenities: z
    .array(z.string().max(50, 'Amenity must be 50 characters or fewer'))
    .max(20, 'Maximum 20 amenities allowed')
    .optional(),
  contactName: z.string().max(200, 'Contact name must be 200 characters or fewer').optional(),
  contactEmail: z.union([emailField, z.literal('')]).optional(),
  contactPhone: z.string().max(50, 'Contact phone must be 50 characters or fewer').optional(),
  website: z.union([urlField, z.literal('')]).optional(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateVenueInput = z.infer<typeof updateVenueSchema>;

// ---- Venue Query (GET /api/organizer/venues) ----

export const venueQuerySchema = paginationSchema.extend({
  search: z.string().max(200, 'Search query too long').optional(),
  city: z.string().max(100, 'City filter too long').optional(),
  country: z.string().max(100, 'Country filter too long').optional(),
});

export type VenueQueryInput = z.infer<typeof venueQuerySchema>;

// ---- Public Venue Selector ----

/**
 * Lightweight venue info for event create/edit venue selector.
 * Used client-side to display available venues for assignment.
 */
export const venueSelectSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string().nullable(),
  country: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  capacity: z.number().nullable(),
});

export type VenueSelectInput = z.infer<typeof venueSelectSchema>;
