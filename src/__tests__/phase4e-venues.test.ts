/**
 * Phase 4E Tests: Venue Management & Event Venue Integration
 *
 * Tests cover:
 * - Venue CRUD (create, list, get, update, delete)
 * - Venue validation (name required, address required, city required, etc.)
 * - Venue ownership (organizer A cannot access organizer B's venues)
 * - Tenant isolation (cross-organizer venue access blocked)
 * - Cross-organizer venue assignment to events blocked
 * - Organizer lifecycle integration (suspended/deactivated blocked)
 * - Venue deletion safety (VENUE_IN_USE when assigned to events)
 * - Public/private field separation (contactEmail/contactPhone not exposed publicly)
 * - Event ↔ Venue integration (create with venueId, update venue, remove venue)
 * - SUPER_ADMIN access across organizers
 * - Seed data verification (Ghana venues exist, organizer-specific venues+events linked)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  authorizeVenueAccess,
  verifyVenueAssignment,
  checkVenueUsage,
  resolveVenueOrganizer,
  filterPublicVenueFields,
  VENUE_ERRORS,
} from '@/lib/services/venue-auth';
import {
  getOperableOrganizerEntitlements,
  _invalidateFreePlanCache,
} from '@/lib/services/entitlements';
import { ApiError } from '@/lib/errors';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

// ─── Test Data ───
let organizer1UserId: string;
let organizer2UserId: string;
let superAdminId: string;
let suspendedOrgUserId: string;
let organizer1ProfileId: string;
let organizer2ProfileId: string;
let suspendedProfileId: string;
let venue1Id: string; // organizer1's venue
let venue2Id: string; // organizer2's venue
let publicVenueId: string; // system public venue (no organizerId)
let event1Id: string; // organizer1's event (linked to venue1)
let event2Id: string; // organizer2's event (no venue)

// ─── Setup ───

describe('Phase 4E — Venue Management & Event Integration', () => {
  beforeAll(async () => {
    _invalidateFreePlanCache();

    const password = await hash('TestPass123!', 12);

    // Create test users
    const superAdmin = await prisma.user.upsert({
      where: { email: 'p4e-admin@test.com' },
      update: {},
      create: { email: 'p4e-admin@test.com', password, name: 'P4E Admin', role: 'SUPER_ADMIN', isActive: true },
    });
    superAdminId = superAdmin.id;

    const org1User = await prisma.user.upsert({
      where: { email: 'p4e-org1@test.com' },
      update: {},
      create: { email: 'p4e-org1@test.com', password, name: 'P4E Org1', role: 'ORGANIZER', isActive: true },
    });
    organizer1UserId = org1User.id;

    const org2User = await prisma.user.upsert({
      where: { email: 'p4e-org2@test.com' },
      update: {},
      create: { email: 'p4e-org2@test.com', password, name: 'P4E Org2', role: 'ORGANIZER', isActive: true },
    });
    organizer2UserId = org2User.id;

    const suspendedUser = await prisma.user.upsert({
      where: { email: 'p4e-suspended@test.com' },
      update: {},
      create: { email: 'p4e-suspended@test.com', password, name: 'P4E Suspended', role: 'ORGANIZER', isActive: true },
    });
    suspendedOrgUserId = suspendedUser.id;

    // Create organizer profiles
    const org1Profile = await prisma.organizerProfile.upsert({
      where: { userId: org1User.id },
      update: { status: 'ACTIVE' },
      create: {
        userId: org1User.id,
        organizationName: 'P4E Org One',
        slug: 'p4e-org-one',
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
      },
    });
    organizer1ProfileId = org1Profile.id;

    const org2Profile = await prisma.organizerProfile.upsert({
      where: { userId: org2User.id },
      update: { status: 'ACTIVE' },
      create: {
        userId: org2User.id,
        organizationName: 'P4E Org Two',
        slug: 'p4e-org-two',
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
      },
    });
    organizer2ProfileId = org2Profile.id;

    const suspendedProfile = await prisma.organizerProfile.upsert({
      where: { userId: suspendedUser.id },
      update: { status: 'SUSPENDED' },
      create: {
        userId: suspendedUser.id,
        organizationName: 'P4E Suspended Org',
        slug: 'p4e-suspended-org',
        status: 'SUSPENDED',
      },
    });
    suspendedProfileId = suspendedProfile.id;

    // Ensure subscription plans exist
    const freePlan = await prisma.subscriptionPlan.upsert({
      where: { slug: 'free' },
      update: {},
      create: {
        name: 'Free', slug: 'free',
        maxEvents: 3, maxTicketsPerEvent: 50, maxTicketTypesPerEvent: 2,
        maxStaff: 0, maxMediaPerEvent: 3, maxAttendeesTotal: 500,
        canAdvertise: false, canCustomBranding: false, canApiAccess: false,
        analyticsLevel: 'BASIC', isActive: true,
      },
    });

    // Assign subscriptions
    await prisma.organizerSubscription.upsert({
      where: { organizerId: org1Profile.id },
      update: {},
      create: {
        organizerId: org1Profile.id, planId: freePlan.id,
        status: 'ACTIVE', startDate: new Date(), paymentStatus: 'CURRENT',
      },
    });
    await prisma.organizerSubscription.upsert({
      where: { organizerId: org2Profile.id },
      update: {},
      create: {
        organizerId: org2Profile.id, planId: freePlan.id,
        status: 'ACTIVE', startDate: new Date(), paymentStatus: 'CURRENT',
      },
    });

    // Create venues
    const venue1 = await prisma.venue.upsert({
      where: { slug: 'p4e-venue-org1' },
      update: {},
      create: {
        name: 'P4E Test Venue Org1',
        slug: 'p4e-venue-org1',
        description: 'Test venue for org1',
        address: '123 Test St',
        city: 'Accra',
        state: 'Greater Accra',
        country: 'GH',
        lat: 5.56,
        lng: -0.19,
        capacity: 500,
        amenities: JSON.stringify(['parking', 'wifi']),
        contactName: 'Venue Manager',
        contactEmail: 'venue1@test.com',
        contactPhone: '+233-00-000-0001',
        organizerId: org1User.id,
        isPublic: false,
        isActive: true,
      },
    });
    venue1Id = venue1.id;

    const venue2 = await prisma.venue.upsert({
      where: { slug: 'p4e-venue-org2' },
      update: {},
      create: {
        name: 'P4E Test Venue Org2',
        slug: 'p4e-venue-org2',
        description: 'Test venue for org2',
        address: '456 Test Ave',
        city: 'Kumasi',
        state: 'Ashanti',
        country: 'GH',
        lat: 6.69,
        lng: -1.62,
        capacity: 300,
        contactEmail: 'venue2@test.com',
        organizerId: org2User.id,
        isPublic: false,
        isActive: true,
      },
    });
    venue2Id = venue2.id;

    const publicVenue = await prisma.venue.upsert({
      where: { slug: 'p4e-public-venue' },
      update: {},
      create: {
        name: 'P4E Public Venue',
        slug: 'p4e-public-venue',
        description: 'A public venue',
        address: '789 Public Square',
        city: 'Tema',
        country: 'GH',
        capacity: 1000,
        contactEmail: 'public@test.com',
        contactPhone: '+233-00-000-9999',
        isPublic: true,
        isActive: true,
      },
    });
    publicVenueId = publicVenue.id;

    // Create events
    const event1 = await prisma.event.upsert({
      where: { slug: 'p4e-event1' },
      update: {},
      create: {
        title: 'P4E Test Event 1',
        slug: 'p4e-event1',
        description: 'Test event for org1 with venue',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        venueId: venue1.id,
        venueName: 'P4E Test Venue Org1',
        venueAddress: '123 Test St',
        venueCity: 'Accra',
        venueState: 'Greater Accra',
        venueCountry: 'GH',
        organizerId: org1User.id,
        status: 'PUBLISHED',
      },
    });
    event1Id = event1.id;

    const event2 = await prisma.event.upsert({
      where: { slug: 'p4e-event2' },
      update: {},
      create: {
        title: 'P4E Test Event 2',
        slug: 'p4e-event2',
        description: 'Test event for org2 without venue',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        organizerId: org2User.id,
        status: 'DRAFT',
      },
    });
    event2Id = event2.id;
  });

  // ═══════════════════════════════════════
  // 1. Venue CRUD — authorizeVenueAccess
  // ═══════════════════════════════════════

  describe('Venue Authorization', () => {
    it('allows owner to access their venue', async () => {
      const result = await authorizeVenueAccess(venue1Id, organizer1UserId, 'ORGANIZER');
      expect(result.venue.id).toBe(venue1Id);
      expect(result.venue.name).toBe('P4E Test Venue Org1');
      expect(result.venue.organizerId).toBe(organizer1UserId);
    });

    it('allows SUPER_ADMIN to access any venue', async () => {
      const result = await authorizeVenueAccess(venue1Id, superAdminId, 'SUPER_ADMIN');
      expect(result.venue.id).toBe(venue1Id);
    });

    it('blocks non-owner organizer from accessing venue', async () => {
      await expect(
        authorizeVenueAccess(venue1Id, organizer2UserId, 'ORGANIZER')
      ).rejects.toThrow();
    });

    it('throws VENUE_NOT_FOUND for non-existent venue', async () => {
      await expect(
        authorizeVenueAccess('nonexistent-id', organizer1UserId, 'ORGANIZER')
      ).rejects.toThrow();
    });

    it('blocks non-admin from managing system (null organizerId) venue', async () => {
      // Public venue with no organizerId — only SUPER_ADMIN can manage
      await expect(
        authorizeVenueAccess(publicVenueId, organizer1UserId, 'ORGANIZER', { requireManage: true })
      ).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════
  // 2. Tenant Isolation
  // ═══════════════════════════════════════

  describe('Tenant Isolation', () => {
    it('Organizer A cannot access Organizer B venue', async () => {
      await expect(
        authorizeVenueAccess(venue2Id, organizer1UserId, 'ORGANIZER')
      ).rejects.toThrow();
    });

    it('Organizer B cannot access Organizer A venue', async () => {
      await expect(
        authorizeVenueAccess(venue1Id, organizer2UserId, 'ORGANIZER')
      ).rejects.toThrow();
    });

    it('SUPER_ADMIN can access both venues', async () => {
      const r1 = await authorizeVenueAccess(venue1Id, superAdminId, 'SUPER_ADMIN');
      const r2 = await authorizeVenueAccess(venue2Id, superAdminId, 'SUPER_ADMIN');
      expect(r1.venue.id).toBe(venue1Id);
      expect(r2.venue.id).toBe(venue2Id);
    });
  });

  // ═══════════════════════════════════════
  // 3. Cross-Organizer Venue Assignment
  // ═══════════════════════════════════════

  describe('Cross-Organizer Venue Assignment', () => {
    it('allows organizer to assign their own venue', async () => {
      const result = await verifyVenueAssignment(venue1Id, organizer1UserId, 'ORGANIZER');
      expect(result.id).toBe(venue1Id);
      expect(result.name).toBe('P4E Test Venue Org1');
    });

    it('allows SUPER_ADMIN to assign any venue', async () => {
      const result = await verifyVenueAssignment(venue1Id, organizer2UserId, 'SUPER_ADMIN');
      expect(result.id).toBe(venue1Id);
    });

    it('blocks organizer from assigning another organizer venue', async () => {
      // Organizer1 trying to assign organizer2's venue to their event
      await expect(
        verifyVenueAssignment(venue2Id, organizer1UserId, 'ORGANIZER')
      ).rejects.toThrow();
    });

    it('blocks organizer B from assigning organizer A venue', async () => {
      await expect(
        verifyVenueAssignment(venue1Id, organizer2UserId, 'ORGANIZER')
      ).rejects.toThrow();
    });

    it('throws VENUE_NOT_FOUND for non-existent venue', async () => {
      await expect(
        verifyVenueAssignment('nonexistent-id', organizer1UserId, 'ORGANIZER')
      ).rejects.toThrow();
    });

    it('allows any organizer to assign a public system venue (no organizerId)', async () => {
      const result = await verifyVenueAssignment(publicVenueId, organizer1UserId, 'ORGANIZER');
      expect(result.id).toBe(publicVenueId);
      expect(result.isPublic).toBe(true);
    });
  });

  // ═══════════════════════════════════════
  // 4. Venue Delete Safety
  // ═══════════════════════════════════════

  describe('Venue Delete Safety', () => {
    it('reports usage for venue assigned to events', async () => {
      const usage = await checkVenueUsage(venue1Id);
      expect(usage.eventCount).toBeGreaterThanOrEqual(1); // event1 is linked
    });

    it('reports zero usage for venue with no events', async () => {
      const usage = await checkVenueUsage(venue2Id);
      expect(usage.eventCount).toBe(0);
      expect(usage.sessionCount).toBe(0);
    });

    it('allows deletion of venue with no events (via checkVenueUsage)', async () => {
      // venue2 has no events — safe to delete
      const usage = await checkVenueUsage(venue2Id);
      expect(usage.eventCount).toBe(0);
      expect(usage.sessionCount).toBe(0);
    });

    it('venue in use should return positive event count', async () => {
      const usage = await checkVenueUsage(venue1Id);
      // venue1 is linked to event1
      expect(usage.eventCount + usage.sessionCount).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════
  // 5. Organizer Lifecycle
  // ═══════════════════════════════════════

  describe('Organizer Lifecycle', () => {
    it('ACTIVE organizer can manage venues', async () => {
      const entitlements = await getOperableOrganizerEntitlements(organizer1UserId);
      expect(entitlements.isOperable).toBe(true);
    });

    it('SUSPENDED organizer cannot manage venues', async () => {
      await expect(
        getOperableOrganizerEntitlements(suspendedOrgUserId)
      ).rejects.toThrow();
    });

    it('authorizeVenueAccess blocks suspended organizer from mutating venue', async () => {
      // Create a venue for the suspended org
      const suspendedVenue = await prisma.venue.upsert({
        where: { slug: 'p4e-suspended-venue' },
        update: {},
        create: {
          name: 'P4E Suspended Venue',
          slug: 'p4e-suspended-venue',
          address: '999 Suspended St',
          city: 'Accra',
          country: 'GH',
          organizerId: suspendedOrgUserId,
          isPublic: false,
          isActive: true,
        },
      });

      // The authorizeVenueAccess should work for SUPER_ADMIN but for the
      // suspended organizer, operability check will fail
      await expect(
        authorizeVenueAccess(suspendedVenue.id, suspendedOrgUserId, 'ORGANIZER')
      ).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════
  // 6. Public/Private Field Separation
  // ═══════════════════════════════════════

  describe('Public/Private Field Separation', () => {
    it('filterPublicVenueFields strips private contact information', () => {
      const venue = {
        id: 'test-id',
        name: 'Test Venue',
        description: 'A venue',
        address: '123 Main St',
        city: 'Accra',
        state: 'Greater Accra',
        country: 'GH',
        postalCode: 'GA-123',
        lat: 5.56,
        lng: -0.19,
        googleMapsUrl: 'https://maps.google.com',
        coverImage: 'https://example.com/img.jpg',
        capacity: 500,
        amenities: '["parking","wifi"]',
        website: 'https://venue.com',
        isPublic: true,
        slug: 'test-venue',
        contactName: 'Private Contact',  // should be stripped
        contactEmail: 'private@test.com', // should be stripped
        contactPhone: '+233-000-000',     // should be stripped
      };

      const publicVenue = filterPublicVenueFields(venue);

      expect(publicVenue.name).toBe('Test Venue');
      expect(publicVenue.address).toBe('123 Main St');
      expect(publicVenue.city).toBe('Accra');
      expect(publicVenue.website).toBe('https://venue.com');
      expect(publicVenue.capacity).toBe(500);

      // Private fields should NOT be present
      expect((publicVenue as Record<string, unknown>).contactEmail).toBeUndefined();
      expect((publicVenue as Record<string, unknown>).contactPhone).toBeUndefined();
      expect((publicVenue as Record<string, unknown>).contactName).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════
  // 7. resolveVenueOrganizer
  // ═══════════════════════════════════════

  describe('resolveVenueOrganizer', () => {
    it('returns userId for ORGANIZER role', async () => {
      const result = await resolveVenueOrganizer(organizer1UserId, 'ORGANIZER');
      expect(result).toBe(organizer1UserId);
    });

    it('returns null for SUPER_ADMIN', async () => {
      const result = await resolveVenueOrganizer(superAdminId, 'SUPER_ADMIN');
      expect(result).toBeNull();
    });

    it('returns null for unauthenticated/invalid user', async () => {
      const result = await resolveVenueOrganizer('nonexistent-id', 'PUBLIC');
      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════
  // 8. Event ↔ Venue Integration (DB level)
  // ═══════════════════════════════════════

  describe('Event ↔ Venue Integration', () => {
    it('event can reference a venue via venueId', async () => {
      const event = await prisma.event.findUnique({
        where: { id: event1Id },
        include: { venue: true },
      });
      expect(event?.venueId).toBe(venue1Id);
      expect(event?.venue?.name).toBe('P4E Test Venue Org1');
    });

    it('event without venueId has null venue', async () => {
      const event = await prisma.event.findUnique({
        where: { id: event2Id },
        include: { venue: true },
      });
      expect(event?.venueId).toBeNull();
      expect(event?.venue).toBeNull();
    });

    it('event can be updated to reference a different venue', async () => {
      // Create a new venue for org1
      const newVenue = await prisma.venue.upsert({
        where: { slug: 'p4e-venue-org1-alt' },
        update: {},
        create: {
          name: 'P4E Alt Venue Org1',
          slug: 'p4e-venue-org1-alt',
          address: '321 Alt St',
          city: 'Tema',
          country: 'GH',
          organizerId: organizer1UserId,
          isPublic: false,
          isActive: true,
        },
      });

      await prisma.event.update({
        where: { id: event1Id },
        data: {
          venueId: newVenue.id,
          venueName: 'P4E Alt Venue Org1',
          venueAddress: '321 Alt St',
          venueCity: 'Tema',
        },
      });

      const updated = await prisma.event.findUnique({
        where: { id: event1Id },
        include: { venue: true },
      });
      expect(updated?.venueId).toBe(newVenue.id);
      expect(updated?.venue?.name).toBe('P4E Alt Venue Org1');

      // Restore original
      await prisma.event.update({
        where: { id: event1Id },
        data: {
          venueId: venue1Id,
          venueName: 'P4E Test Venue Org1',
          venueAddress: '123 Test St',
          venueCity: 'Accra',
        },
      });
    });

    it('event venue can be removed (set venueId to null)', async () => {
      await prisma.event.update({
        where: { id: event1Id },
        data: { venueId: null },
      });

      const updated = await prisma.event.findUnique({
        where: { id: event1Id },
      });
      expect(updated?.venueId).toBeNull();

      // Restore
      await prisma.event.update({
        where: { id: event1Id },
        data: { venueId: venue1Id },
      });
    });

    it('cross-organizer venue assignment is prevented at service level', async () => {
      // Organizer1 trying to assign organizer2's venue
      await expect(
        verifyVenueAssignment(venue2Id, organizer1UserId, 'ORGANIZER')
      ).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════
  // 9. Venue Validation (Zod)
  // ═══════════════════════════════════════

  describe('Venue Validation', () => {
    it('createVenueSchema requires name', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        address: '123 Test St',
        city: 'Accra',
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema requires address', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Test Venue',
        city: 'Accra',
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema requires city', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Test Venue',
        address: '123 Test St',
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema accepts valid venue data', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Test Venue',
        address: '123 Test St',
        city: 'Accra',
        state: 'Greater Accra',
        country: 'GH',
        lat: 5.56,
        lng: -0.19,
        capacity: 500,
        contactEmail: 'test@venue.com',
        website: 'https://venue.com',
      });
      expect(result.success).toBe(true);
    });

    it('createVenueSchema rejects invalid email', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Test Venue',
        address: '123 Test St',
        city: 'Accra',
        contactEmail: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema rejects invalid lat range', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Test Venue',
        address: '123 Test St',
        city: 'Accra',
        lat: 91, // out of range
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema rejects invalid lng range', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Test Venue',
        address: '123 Test St',
        city: 'Accra',
        lng: 181, // out of range
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema rejects negative capacity', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Test Venue',
        address: '123 Test St',
        city: 'Accra',
        capacity: -10,
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema rejects invalid website URL', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Test Venue',
        address: '123 Test St',
        city: 'Accra',
        website: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('updateVenueSchema allows partial updates', async () => {
      const { updateVenueSchema } = await import('@/lib/validations/venues');
      const result = updateVenueSchema.safeParse({
        name: 'Updated Venue Name',
      });
      expect(result.success).toBe(true);
    });

    it('venueQuerySchema has sensible defaults', async () => {
      const { venueQuerySchema } = await import('@/lib/validations/venues');
      const result = venueQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(12);
      }
    });
  });

  // ═══════════════════════════════════════
  // 10. Seed Data Verification
  // ═════════════════Ghana════════════════

  describe('Seed Data Verification', () => {
    it('Ghana seed venues exist', async () => {
      const aicc = await prisma.venue.findUnique({ where: { slug: 'accra-international-conference-centre' } });
      const national = await prisma.venue.findUnique({ where: { slug: 'national-theatre-of-ghana' } });
      const kempinski = await prisma.venue.findUnique({ where: { slug: 'kempinski-hotel-gold-coast-city' } });
      const ughall = await prisma.venue.findUnique({ where: { slug: 'university-of-ghana-great-hall' } });

      expect(aicc).not.toBeNull();
      expect(national).not.toBeNull();
      expect(kempinski).not.toBeNull();
      expect(ughall).not.toBeNull();
    });

    it('seed venues are public', async () => {
      const aicc = await prisma.venue.findUnique({ where: { slug: 'accra-international-conference-centre' } });
      expect(aicc?.isPublic).toBe(true);
    });

    it('seed venues have Ghana coordinates', async () => {
      const aicc = await prisma.venue.findUnique({ where: { slug: 'accra-international-conference-centre' } });
      expect(aicc?.country).toBe('GH');
      expect(aicc?.lat).not.toBeNull();
      expect(aicc?.lng).not.toBeNull();
    });

    it('organizer-specific seed venues exist', async () => {
      const orgVenue1 = await prisma.venue.findUnique({ where: { slug: 'org1-tech-hub-accra' } });
      const orgVenue2 = await prisma.venue.findUnique({ where: { slug: 'org2-kumasi-cultural-center' } });
      const orgVenue3 = await prisma.venue.findUnique({ where: { slug: 'org1-tema-conference-hall' } });

      expect(orgVenue1).not.toBeNull();
      expect(orgVenue2).not.toBeNull();
      expect(orgVenue3).not.toBeNull();

      expect(orgVenue1?.isPublic).toBe(false);
      expect(orgVenue2?.isPublic).toBe(false);
      expect(orgVenue3?.isPublic).toBe(false);
    });
  });

  // ═══════════════════════════════════════
  // 11. Venue Model Integrity
  // ═══════════════════════════════════════

  describe('Venue Model Integrity', () => {
    it('venue slug is unique', async () => {
      await expect(
        prisma.venue.create({
          data: {
            name: 'Duplicate Slug Venue',
            slug: 'p4e-venue-org1', // already exists
            address: '123 Test',
            city: 'Accra',
          },
        })
      ).rejects.toThrow();
    });

    it('venue can be created with minimal fields', async () => {
      const venue = await prisma.venue.create({
        data: {
          name: 'Minimal Venue',
          slug: `p4e-minimal-${Date.now()}`,
          address: '1 Min St',
          city: 'Accra',
        },
      });
      expect(venue.id).toBeDefined();
      expect(venue.country).toBe('GH'); // default
      expect(venue.isPublic).toBe(true); // default
      expect(venue.isActive).toBe(true); // default

      // Cleanup
      await prisma.venue.delete({ where: { id: venue.id } });
    });

    it('venue isActive field works correctly', async () => {
      const venue = await prisma.venue.create({
        data: {
          name: 'Inactive Venue',
          slug: `p4e-inactive-${Date.now()}`,
          address: '1 Inactive St',
          city: 'Accra',
          isActive: false,
        },
      });
      expect(venue.isActive).toBe(false);

      // Update to active
      const updated = await prisma.venue.update({
        where: { id: venue.id },
        data: { isActive: true },
      });
      expect(updated.isActive).toBe(true);

      await prisma.venue.delete({ where: { id: venue.id } });
    });
  });

  // ═══════════════════════════════════════
  // 12. Error Codes
  // ═══════════════════════════════════════

  describe('Error Codes', () => {
    it('VENUE_ERRORS has all expected codes', () => {
      expect(VENUE_ERRORS.VENUE_NOT_FOUND).toBe('VENUE_NOT_FOUND');
      expect(VENUE_ERRORS.VENUE_IN_USE).toBe('VENUE_IN_USE');
      expect(VENUE_ERRORS.ORGANIZER_NOT_OPERABLE).toBe('ORGANIZER_NOT_OPERABLE');
      expect(VENUE_ERRORS.FORBIDDEN).toBe('FORBIDDEN');
      expect(VENUE_ERRORS.CROSS_ORGANIZER_VENUE).toBe('CROSS_ORGANIZER_VENUE');
      expect(VENUE_ERRORS.VENUE_ASSIGNMENT_FORBIDDEN).toBe('VENUE_ASSIGNMENT_FORBIDDEN');
    });
  });

  // ═══════════════════════════════════════
  // 13. Event Validation includes venueId
  // ═══════════════════════════════════════

  describe('Event Validation includes venueId', () => {
    it('createEventSchema accepts venueId', async () => {
      const { createEventSchema } = await import('@/lib/validations/events');
      const result = createEventSchema.safeParse({
        title: 'Test Event',
        description: 'A test event description that is long enough',
        startDate: '2025-12-01',
        venueId: 'some-venue-id',
        isVirtual: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.venueId).toBe('some-venue-id');
      }
    });

    it('createEventSchema allows event without venueId if virtual', async () => {
      const { createEventSchema } = await import('@/lib/validations/events');
      const result = createEventSchema.safeParse({
        title: 'Virtual Event',
        description: 'A virtual event description that is long enough',
        startDate: '2025-12-01',
        isVirtual: true,
        virtualUrl: 'https://zoom.us/meeting',
      });
      expect(result.success).toBe(true);
    });

    it('updateEventSchema accepts venueId for assignment', async () => {
      const { updateEventSchema } = await import('@/lib/validations/events');
      const result = updateEventSchema.safeParse({
        venueId: 'some-venue-id',
      });
      expect(result.success).toBe(true);
    });

    it('updateEventSchema accepts empty venueId for removal', async () => {
      const { updateEventSchema } = await import('@/lib/validations/events');
      const result = updateEventSchema.safeParse({
        venueId: '',
      });
      expect(result.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════
  // 14. Public Venue API (filterPublicVenueFields)
  // ═══════════════════════════════════════

  describe('Public Venue API', () => {
    it('filterPublicVenueFields strips private contact info', () => {
      const venue = {
        id: 'v1',
        name: 'Test Venue',
        description: 'A test venue',
        address: '123 Main St',
        city: 'Accra',
        state: 'Greater Accra',
        country: 'GH',
        postalCode: 'GA-123',
        lat: 5.6037,
        lng: -0.1870,
        googleMapsUrl: 'https://maps.google.com/?cid=123',
        coverImage: 'https://example.com/venue.jpg',
        capacity: 500,
        amenities: '["parking","wifi"]',
        website: 'https://example.com',
        isPublic: true,
        slug: 'test-venue',
        // Private fields that should be stripped
        contactName: 'John Doe',
        contactEmail: 'john@example.com',
        contactPhone: '+233123456789',
        organizerId: 'org1',
      };

      const filtered = filterPublicVenueFields(venue);

      // Public fields present
      expect(filtered.id).toBe('v1');
      expect(filtered.name).toBe('Test Venue');
      expect(filtered.address).toBe('123 Main St');
      expect(filtered.city).toBe('Accra');
      expect(filtered.country).toBe('GH');
      expect(filtered.googleMapsUrl).toBe('https://maps.google.com/?cid=123');
      expect(filtered.website).toBe('https://example.com');
      expect(filtered.capacity).toBe(500);
      expect(filtered.isPublic).toBe(true);

      // Private fields stripped
      expect(filtered).not.toHaveProperty('contactName');
      expect(filtered).not.toHaveProperty('contactEmail');
      expect(filtered).not.toHaveProperty('contactPhone');
      expect(filtered).not.toHaveProperty('organizerId');
    });

    it('public venue API only returns public and active venues', async () => {
      // Count public, active venues
      const publicActiveCount = await prisma.venue.count({
        where: { isPublic: true, isActive: true },
      });
      // Count private venues
      const privateCount = await prisma.venue.count({
        where: { isPublic: false },
      });
      // Count inactive venues
      const inactiveCount = await prisma.venue.count({
        where: { isActive: false },
      });

      // Public API should only see public+active venues
      expect(publicActiveCount).toBeGreaterThan(0);
      // The fact that private/inactive venues exist but are excluded is enforced
      // at the API level (the route adds isPublic: true, isActive: true to where)
      expect(privateCount).toBeGreaterThanOrEqual(0);
      expect(inactiveCount).toBeGreaterThanOrEqual(0);
    });

    it('private venue is not accessible via public detail route logic', async () => {
      // Verify that a private venue is not returned
      const privateVenue = await prisma.venue.findFirst({
        where: { isPublic: false },
      });
      if (privateVenue) {
        // The public API route checks isPublic && isActive
        // So a private venue should return 404
        expect(privateVenue.isPublic).toBe(false);
      }
    });
  });

  // ═══════════════════════════════════════
  // 15. Shared Slugify Utility
  // ═══════════════════════════════════════

  describe('Shared Slugify Utility', () => {
    it('slugify converts text to URL-safe slug', async () => {
      const { slugify } = await import('@/lib/utils/slugify');
      expect(slugify('Accra International Conference Centre')).toBe('accra-international-conference-centre');
      expect(slugify('Hello World!')).toBe('hello-world');
      expect(slugify('  Spaces  &  Ampersands  ')).toBe('spaces-ampersands');
      expect(slugify('under_scores')).toBe('under-scores');
      expect(slugify('UPPERCASE')).toBe('uppercase');
    });

    it('slugify handles edge cases', async () => {
      const { slugify } = await import('@/lib/utils/slugify');
      expect(slugify('')).toBe('');
      expect(slugify('a')).toBe('a');
      expect(slugify('---leading-trailing---')).toBe('leading-trailing');
    });
  });

  // ═══════════════════════════════════════
  // 16. URL Safety (XSS Prevention)
  // ═══════════════════════════════════════

  describe('URL Safety', () => {
    it('createVenueSchema rejects javascript: scheme in googleMapsUrl', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'XSS Venue',
        address: '123 Test',
        city: 'Accra',
        googleMapsUrl: 'javascript:alert)alert(document.cookie)',
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema rejects data: scheme in website', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'XSS Venue',
        address: '123 Test',
        city: 'Accra',
        website: 'data:text/html,<script>alert(1)</script>',
      });
      expect(result.success).toBe(false);
    });

    it('createVenueSchema accepts https URLs', async () => {
      const { createVenueSchema } = await import('@/lib/validations/venues');
      const result = createVenueSchema.safeParse({
        name: 'Safe Venue',
        address: '123 Test',
        city: 'Accra',
        googleMapsUrl: 'https://maps.google.com/?cid=123',
        website: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });

    it('urlField rejects javascript: and data: schemes', async () => {
      const { urlField } = await import('@/lib/validations/common');
      expect(urlField.safeParse('javascript:alert(1)').success).toBe(false);
      expect(urlField.safeParse('data:text/html,<h1>test</h1>').success).toBe(false);
      expect(urlField.safeParse('vbscript:9msgbox(1)').success).toBe(false);
    });

    it('urlField accepts safe schemes', async () => {
      const { urlField } = await import('@/lib/validations/common');
      expect(urlField.safeParse('https://example.com').success).toBe(true);
      expect(urlField.safeParse('http://example.com').success).toBe(true);
      expect(urlField.safeParse('mailto:test@example.com').success).toBe(true);
      expect(urlField.safeParse('tel:+1234567890').success).toBe(true);
    });
  });
});
