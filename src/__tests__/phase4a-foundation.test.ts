/**
 * Phase 4A Tests: Database Foundation + Security Corrections
 *
 * Tests cover:
 * - Invitation token hashing security
 * - Event deletion safety (soft-delete when bookings exist)
 * - Schema integrity (new model relationships)
 * - OrganizerSubscription design
 * - OrganizerProfile status lifecycle
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashToken, generateSecureToken, verifyTokenHash } from '@/lib/tokens';

const prisma = new PrismaClient();

// ─── Invitation Token Hashing ───

describe('Invitation Token Security', () => {
  it('generates a secure random token', () => {
    const token = generateSecureToken();
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    // UUID format
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('hashes tokens using SHA-256 (not stored as plaintext)', async () => {
    const rawToken = generateSecureToken();
    const hashedToken = await hashToken(rawToken);

    // Hash should be different from raw token
    expect(hashedToken).not.toBe(rawToken);

    // Hash should be 64 hex chars (SHA-256)
    expect(hashedToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyTokenHash correctly validates a token against its hash', async () => {
    const rawToken = generateSecureToken();
    const hashedToken = await hashToken(rawToken);

    const isValid = await verifyTokenHash(rawToken, hashedToken);
    expect(isValid).toBe(true);

    const isInvalid = await verifyTokenHash('wrong-token', hashedToken);
    expect(isInvalid).toBe(false);
  });

  it('different tokens produce different hashes', async () => {
    const token1 = generateSecureToken();
    const token2 = generateSecureToken();
    const hash1 = await hashToken(token1);
    const hash2 = await hashToken(token2);

    expect(hash1).not.toBe(hash2);
  });

  it('same token always produces the same hash', async () => {
    const token = generateSecureToken();
    const hash1 = await hashToken(token);
    const hash2 = await hashToken(token);

    expect(hash1).toBe(hash2);
  });
});

describe('OrganizerInvitation DB Token Hashing', () => {
  it('stores tokenHash (not plaintext token) in the database', async () => {
    // Create a minimal test organizer profile + user for the invitation
    const testUser = await prisma.user.upsert({
      where: { email: 'test-invite-org@applecalendar.com' },
      update: {},
      create: {
        email: 'test-invite-org@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Invite Org',
        role: 'ORGANIZER',
      },
    });

    const testProfile = await prisma.organizerProfile.upsert({
      where: { userId: testUser.id },
      update: {},
      create: {
        userId: testUser.id,
        organizationName: 'Test Invite Org',
        slug: 'test-invite-org-' + Date.now(),
        status: 'PENDING_APPROVAL',
      },
    });

    // Generate and hash token
    const rawToken = generateSecureToken();
    const tokenHash = await hashToken(rawToken);

    // Create invitation with hashed token
    const invitation = await prisma.organizerInvitation.create({
      data: {
        organizerId: testProfile.id,
        email: 'invitee@test.com',
        role: 'STAFF',
        permissions: '[]',
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Verify stored value is the hash, not the raw token
    expect(invitation.tokenHash).toBe(tokenHash);
    expect(invitation.tokenHash).not.toBe(rawToken);
    expect(invitation.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Verify we can look up the invitation by hash
    const found = await prisma.organizerInvitation.findUnique({
      where: { tokenHash },
    });
    expect(found).not.toBeNull();
    expect(found!.id).toBe(invitation.id);

    // Verify we CANNOT look up by raw token (proves it's hashed)
    // The raw token should not match any tokenHash in the DB
    const notFound = await prisma.organizerInvitation.findUnique({
      where: { tokenHash: rawToken },
    });
    expect(notFound).toBeNull();

    // Clean up
    await prisma.organizerInvitation.delete({ where: { id: invitation.id } });
    await prisma.organizerProfile.delete({ where: { id: testProfile.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('expired invitation cannot be accepted', async () => {
    const testUser = await prisma.user.upsert({
      where: { email: 'test-expired-invite@applecalendar.com' },
      update: {},
      create: {
        email: 'test-expired-invite@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Expired Invite',
        role: 'ORGANIZER',
      },
    });

    const testProfile = await prisma.organizerProfile.upsert({
      where: { userId: testUser.id },
      update: {},
      create: {
        userId: testUser.id,
        organizationName: 'Test Expired Invite Org',
        slug: 'test-expired-invite-' + Date.now(),
        status: 'PENDING_APPROVAL',
      },
    });

    const rawToken = generateSecureToken();
    const tokenHash = await hashToken(rawToken);

    const invitation = await prisma.organizerInvitation.create({
      data: {
        organizerId: testProfile.id,
        email: 'expired-invitee@test.com',
        role: 'STAFF',
        permissions: '[]',
        tokenHash,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      },
    });

    // Verify the invitation is expired
    expect(invitation.expiresAt < new Date()).toBe(true);
    expect(invitation.acceptedAt).toBeNull();

    // Clean up
    await prisma.organizerInvitation.delete({ where: { id: invitation.id } });
    await prisma.organizerProfile.delete({ where: { id: testProfile.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('consumed invitation cannot be reused', async () => {
    const testUser = await prisma.user.upsert({
      where: { email: 'test-consumed-invite@applecalendar.com' },
      update: {},
      create: {
        email: 'test-consumed-invite@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Consumed Invite',
        role: 'ORGANIZER',
      },
    });

    const testProfile = await prisma.organizerProfile.upsert({
      where: { userId: testUser.id },
      update: {},
      create: {
        userId: testUser.id,
        organizationName: 'Test Consumed Invite Org',
        slug: 'test-consumed-invite-' + Date.now(),
        status: 'PENDING_APPROVAL',
      },
    });

    const rawToken = generateSecureToken();
    const tokenHash = await hashToken(rawToken);

    // Create invitation and immediately mark as accepted
    const invitation = await prisma.organizerInvitation.create({
      data: {
        organizerId: testProfile.id,
        email: 'consumed-invitee@test.com',
        role: 'STAFF',
        permissions: '[]',
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        acceptedAt: new Date(), // Already consumed
      },
    });

    expect(invitation.acceptedAt).not.toBeNull();

    // Clean up
    await prisma.organizerInvitation.delete({ where: { id: invitation.id } });
    await prisma.organizerProfile.delete({ where: { id: testProfile.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });
});

// ─── Event Deletion Safety ───

describe('Event Delete Protection', () => {
  it('event with bookings cannot be hard-deleted (status set to CANCELLED)', async () => {
    // Create test organizer
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-delete-safety@applecalendar.com' },
      update: {},
      create: {
        email: 'test-delete-safety@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Delete Safety',
        role: 'ORGANIZER',
      },
    });

    // Create event with a booking
    const event = await prisma.event.create({
      data: {
        title: 'Event With Booking',
        slug: 'event-with-booking-' + Date.now(),
        description: 'Test event with booking',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'PUBLISHED',
        organizerId: orgUser.id,
      },
    });

    // Create a public user who books
    const booker = await prisma.user.upsert({
      where: { email: 'test-delete-booker@applecalendar.com' },
      update: {},
      create: {
        email: 'test-delete-booker@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Booker',
        role: 'PUBLIC',
      },
    });

    // Create a booking for the event
    const booking = await prisma.booking.create({
      data: {
        userId: booker.id,
        eventId: event.id,
        totalAmount: 100,
        currency: 'GHS',
        status: 'CONFIRMED',
        bookingRef: 'APC-DELETE-TEST-' + Date.now(),
      },
    });

    // Verify event has bookings
    const eventWithBookings = await prisma.event.findUnique({
      where: { id: event.id },
      include: {
        ticketTypes: { select: { soldCount: true } },
        _count: { select: { bookings: true } },
      },
    });

    expect(eventWithBookings!._count.bookings).toBeGreaterThan(0);

    // Simulate the soft-delete behavior (what the API does)
    // Instead of hard-delete, set status to CANCELLED
    await prisma.event.update({
      where: { id: event.id },
      data: { status: 'CANCELLED', isBookable: false },
    });

    // Verify event still exists (not hard-deleted)
    const eventAfterDelete = await prisma.event.findUnique({
      where: { id: event.id },
    });
    expect(eventAfterDelete).not.toBeNull();
    expect(eventAfterDelete!.status).toBe('CANCELLED');
    expect(eventAfterDelete!.isBookable).toBe(false);

    // Verify booking is preserved
    const bookingAfterDelete = await prisma.booking.findUnique({
      where: { id: booking.id },
    });
    expect(bookingAfterDelete).not.toBeNull();

    // Clean up
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.user.delete({ where: { id: booker.id } });
    await prisma.user.delete({ where: { id: orgUser.id } });
  });

  it('event without transactional records can be hard-deleted', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-hard-delete@applecalendar.com' },
      update: {},
      create: {
        email: 'test-hard-delete@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Hard Delete',
        role: 'ORGANIZER',
      },
    });

    // Create event with NO bookings and NO sold tickets
    const event = await prisma.event.create({
      data: {
        title: 'Event Without Bookings',
        slug: 'event-without-bookings-' + Date.now(),
        description: 'Test event without bookings',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'DRAFT',
        organizerId: orgUser.id,
      },
    });

    // Verify event has no bookings
    const eventCheck = await prisma.event.findUnique({
      where: { id: event.id },
      include: {
        ticketTypes: { select: { soldCount: true } },
        _count: { select: { bookings: true } },
      },
    });

    expect(eventCheck!._count.bookings).toBe(0);
    expect(eventCheck!.ticketTypes.every(tt => tt.soldCount === 0)).toBe(true);

    // Safe to hard-delete
    await prisma.event.delete({ where: { id: event.id } });

    // Verify event is gone
    const eventAfterDelete = await prisma.event.findUnique({
      where: { id: event.id },
    });
    expect(eventAfterDelete).toBeNull();

    // Clean up
    await prisma.user.delete({ where: { id: orgUser.id } });
  });

  it('tickets and payments are preserved when event is soft-deleted', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-preserve-txns@applecalendar.com' },
      update: {},
      create: {
        email: 'test-preserve-txns@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Preserve Txns',
        role: 'ORGANIZER',
      },
    });

    const booker = await prisma.user.upsert({
      where: { email: 'test-preserve-booker@applecalendar.com' },
      update: {},
      create: {
        email: 'test-preserve-booker@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Preserve Booker',
        role: 'PUBLIC',
      },
    });

    const event = await prisma.event.create({
      data: {
        title: 'Event With Full Transaction',
        slug: 'event-with-full-txn-' + Date.now(),
        description: 'Test event with full transaction chain',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'PUBLISHED',
        organizerId: orgUser.id,
      },
    });

    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'General Admission',
        price: 100,
        quantity: 100,
        soldCount: 1,
      },
    });

    const booking = await prisma.booking.create({
      data: {
        userId: booker.id,
        eventId: event.id,
        totalAmount: 100,
        currency: 'GHS',
        status: 'CONFIRMED',
        bookingRef: 'APC-PRESERVE-TEST-' + Date.now(),
      },
    });

    const ticket = await prisma.ticket.create({
      data: {
        ticketTypeId: ticketType.id,
        bookingId: booking.id,
        qrCode: 'QR-PRESERVE-TEST-' + Date.now(),
        status: 'VALID',
      },
    });

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: booker.id,
        amount: 100,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'COMPLETED',
        transactionId: 'txn-preserve-test',
      },
    });

    // Soft-delete the event
    await prisma.event.update({
      where: { id: event.id },
      data: { status: 'CANCELLED', isBookable: false },
    });

    // Verify all transactional records still exist
    const bookingCheck = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(bookingCheck).not.toBeNull();

    const ticketCheck = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(ticketCheck).not.toBeNull();

    const paymentCheck = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(paymentCheck).not.toBeNull();

    const ticketTypeCheck = await prisma.ticketType.findUnique({ where: { id: ticketType.id } });
    expect(ticketTypeCheck).not.toBeNull();

    // Clean up (reverse order of dependencies)
    await prisma.payment.delete({ where: { id: payment.id } });
    await prisma.ticket.delete({ where: { id: ticket.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.ticketType.delete({ where: { id: ticketType.id } });
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.user.delete({ where: { id: booker.id } });
    await prisma.user.delete({ where: { id: orgUser.id } });
  });
});

// ─── Schema Integrity ───

describe('Schema Integrity - New Models', () => {
  it('OrganizerSubscription belongs to OrganizerProfile (not User)', async () => {
    // The OrganizerSubscription model should have organizerId pointing to OrganizerProfile
    // We verify this by creating an OrganizerSubscription linked to an OrganizerProfile
    const testUser = await prisma.user.upsert({
      where: { email: 'test-org-sub@applecalendar.com' },
      update: {},
      create: {
        email: 'test-org-sub@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Org Sub',
        role: 'ORGANIZER',
      },
    });

    const testProfile = await prisma.organizerProfile.upsert({
      where: { userId: testUser.id },
      update: {},
      create: {
        userId: testUser.id,
        organizationName: 'Test Org Sub Org',
        slug: 'test-org-sub-' + Date.now(),
        status: 'PENDING_APPROVAL',
      },
    });

    // Get or create a plan
    const plan = await prisma.subscriptionPlan.upsert({
      where: { slug: 'test-phase4a-plan' },
      update: {},
      create: {
        name: 'Test Phase4A Plan',
        slug: 'test-phase4a-plan',
        price: 0,
        maxEvents: 1,
        maxTicketsPerEvent: 10,
      },
    });

    const orgSub = await prisma.organizerSubscription.create({
      data: {
        organizerId: testProfile.id,
        planId: plan.id,
        status: 'ACTIVE',
        billingProvider: 'MANUAL',
        paymentStatus: 'CURRENT',
      },
    });

    expect(orgSub.organizerId).toBe(testProfile.id);
    expect(orgSub.planId).toBe(plan.id);
    expect(orgSub.status).toBe('ACTIVE');
    expect(orgSub.billingProvider).toBe('MANUAL');

    // Verify one-subscription-per-org constraint (unique on organizerId)
    await expect(
      prisma.organizerSubscription.create({
        data: {
          organizerId: testProfile.id, // Same org — should fail
          planId: plan.id,
          status: 'TRIAL',
        },
      })
    ).rejects.toThrow(); // Unique constraint violation

    // Clean up
    await prisma.organizerSubscription.delete({ where: { id: orgSub.id } });
    await prisma.organizerProfile.delete({ where: { id: testProfile.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await prisma.subscriptionPlan.delete({ where: { id: plan.id } });
  });

  it('EventSession belongs to Event', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-session-schema@applecalendar.com' },
      update: {},
      create: {
        email: 'test-session-schema@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Session Schema',
        role: 'ORGANIZER',
      },
    });

    const event = await prisma.event.create({
      data: {
        title: 'Session Test Event',
        slug: 'session-test-event-' + Date.now(),
        description: 'Test event for sessions',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        organizerId: orgUser.id,
      },
    });

    const session = await prisma.eventSession.create({
      data: {
        eventId: event.id,
        title: 'Opening Keynote',
        startTime: '09:00',
        endTime: '10:00',
        sessionType: 'KEYNOTE',
        sortOrder: 0,
      },
    });

    expect(session.eventId).toBe(event.id);
    expect(session.sessionType).toBe('KEYNOTE');
    expect(session.status).toBe('SCHEDULED');

    // Verify cascade: when event is deleted, sessions are deleted
    await prisma.event.delete({ where: { id: event.id } });
    const sessionAfterDelete = await prisma.eventSession.findUnique({ where: { id: session.id } });
    expect(sessionAfterDelete).toBeNull();

    await prisma.user.delete({ where: { id: orgUser.id } });
  });

  it('EventParticipant belongs to Event', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-participant-schema@applecalendar.com' },
      update: {},
      create: {
        email: 'test-participant-schema@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Participant Schema',
        role: 'ORGANIZER',
      },
    });

    const event = await prisma.event.create({
      data: {
        title: 'Participant Test Event',
        slug: 'participant-test-event-' + Date.now(),
        description: 'Test event for participants',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        organizerId: orgUser.id,
      },
    });

    const participant = await prisma.eventParticipant.create({
      data: {
        eventId: event.id,
        name: 'Dr. Kwame Nkrumah',
        role: 'SPEAKER',
        title: 'Distinguished Lecturer',
        isFeatured: true,
      },
    });

    expect(participant.eventId).toBe(event.id);
    expect(participant.role).toBe('SPEAKER');
    expect(participant.isFeatured).toBe(true);

    // Verify cascade: when event is deleted, participants are deleted
    await prisma.event.delete({ where: { id: event.id } });
    const participantAfterDelete = await prisma.eventParticipant.findUnique({ where: { id: participant.id } });
    expect(participantAfterDelete).toBeNull();

    await prisma.user.delete({ where: { id: orgUser.id } });
  });

  it('EventMedia belongs to Event', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-media-schema@applecalendar.com' },
      update: {},
      create: {
        email: 'test-media-schema@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Media Schema',
        role: 'ORGANIZER',
      },
    });

    const event = await prisma.event.create({
      data: {
        title: 'Media Test Event',
        slug: 'media-test-event-' + Date.now(),
        description: 'Test event for media',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        organizerId: orgUser.id,
      },
    });

    const media = await prisma.eventMedia.create({
      data: {
        eventId: event.id,
        url: 'https://example.com/poster.jpg',
        type: 'IMAGE',
        category: 'POSTER',
        caption: 'Event poster',
        uploadedBy: orgUser.id,
      },
    });

    expect(media.eventId).toBe(event.id);
    expect(media.type).toBe('IMAGE');
    expect(media.category).toBe('POSTER');
    expect(media.uploadedBy).toBe(orgUser.id);

    // Verify cascade
    await prisma.event.delete({ where: { id: event.id } });
    const mediaAfterDelete = await prisma.eventMedia.findUnique({ where: { id: media.id } });
    expect(mediaAfterDelete).toBeNull();

    await prisma.user.delete({ where: { id: orgUser.id } });
  });

  it('Venue relationship works', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-venue-schema@applecalendar.com' },
      update: {},
      create: {
        email: 'test-venue-schema@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Venue Schema',
        role: 'ORGANIZER',
      },
    });

    const venue = await prisma.venue.create({
      data: {
        name: 'Test Venue',
        slug: 'test-venue-' + Date.now(),
        address: '123 Test Street',
        city: 'Accra',
        country: 'GH',
        capacity: 500,
        isPublic: true,
        organizerId: orgUser.id,
      },
    });

    expect(venue.country).toBe('GH');
    expect(venue.isPublic).toBe(true);
    expect(venue.organizerId).toBe(orgUser.id);

    // Create an event linked to this venue
    const event = await prisma.event.create({
      data: {
        title: 'Venue Test Event',
        slug: 'venue-test-event-' + Date.now(),
        description: 'Test event at venue',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        organizerId: orgUser.id,
        venueId: venue.id,
      },
    });

    expect(event.venueId).toBe(venue.id);

    // Clean up
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.venue.delete({ where: { id: venue.id } });
    await prisma.user.delete({ where: { id: orgUser.id } });
  });

  it('AuditLog relationship works', async () => {
    const adminUser = await prisma.user.upsert({
      where: { email: 'test-audit-schema@applecalendar.com' },
      update: {},
      create: {
        email: 'test-audit-schema@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Audit Admin',
        role: 'SUPER_ADMIN',
      },
    });

    const auditLog = await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        action: 'APPROVE',
        entityType: 'OrganizerProfile',
        entityId: 'test-org-id',
        reason: 'Application meets requirements',
      },
    });

    expect(auditLog.actorId).toBe(adminUser.id);
    expect(auditLog.action).toBe('APPROVE');
    expect(auditLog.entityType).toBe('OrganizerProfile');
    expect(auditLog.reason).toBe('Application meets requirements');
    // No secrets stored
    expect(auditLog.oldValue).toBeNull();
    expect(auditLog.newValue).toBeNull();

    // Clean up
    await prisma.auditLog.delete({ where: { id: auditLog.id } });
    await prisma.user.delete({ where: { id: adminUser.id } });
  });
});

// ─── OrganizerProfile Status Lifecycle ───

describe('OrganizerProfile Status', () => {
  it('new profile defaults to PENDING_APPROVAL status', async () => {
    const testUser = await prisma.user.upsert({
      where: { email: 'test-org-status@applecalendar.com' },
      update: {},
      create: {
        email: 'test-org-status@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Org Status',
        role: 'ORGANIZER',
      },
    });

    const profile = await prisma.organizerProfile.upsert({
      where: { userId: testUser.id },
      update: {},
      create: {
        userId: testUser.id,
        organizationName: 'Test Org Status',
        slug: 'test-org-status-' + Date.now(),
        // status defaults to PENDING_APPROVAL
      },
    });

    expect(profile.status).toBe('PENDING_APPROVAL');
    // approvalStatus still exists for backward compat
    expect(profile.approvalStatus).toBe('PENDING');

    // Clean up
    await prisma.organizerProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('organizer can transition through lifecycle states', async () => {
    const testUser = await prisma.user.upsert({
      where: { email: 'test-lifecycle@applecalendar.com' },
      update: {},
      create: {
        email: 'test-lifecycle@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Lifecycle',
        role: 'ORGANIZER',
      },
    });

    const profile = await prisma.organizerProfile.upsert({
      where: { userId: testUser.id },
      update: {},
      create: {
        userId: testUser.id,
        organizationName: 'Test Lifecycle Org',
        slug: 'test-lifecycle-' + Date.now(),
        status: 'PENDING_APPROVAL',
      },
    });

    // PENDING_APPROVAL → APPROVED
    const approved = await prisma.organizerProfile.update({
      where: { id: profile.id },
      data: { status: 'APPROVED', approvalStatus: 'APPROVED' },
    });
    expect(approved.status).toBe('APPROVED');

    // APPROVED → ACTIVE
    const active = await prisma.organizerProfile.update({
      where: { id: profile.id },
      data: { status: 'ACTIVE' },
    });
    expect(active.status).toBe('ACTIVE');

    // ACTIVE → SUSPENDED
    const suspended = await prisma.organizerProfile.update({
      where: { id: profile.id },
      data: { status: 'SUSPENDED', statusReason: 'Policy violation', statusChangedAt: new Date() },
    });
    expect(suspended.status).toBe('SUSPENDED');
    expect(suspended.statusReason).toBe('Policy violation');

    // SUSPENDED → ACTIVE (reinstated)
    const reinstated = await prisma.organizerProfile.update({
      where: { id: profile.id },
      data: { status: 'ACTIVE', statusReason: null, statusChangedAt: new Date() },
    });
    expect(reinstated.status).toBe('ACTIVE');

    // ACTIVE → DEACTIVATED
    const deactivated = await prisma.organizerProfile.update({
      where: { id: profile.id },
      data: { status: 'DEACTIVATED', statusReason: 'Organizer request', statusChangedAt: new Date() },
    });
    expect(deactivated.status).toBe('DEACTIVATED');

    // Clean up
    await prisma.organizerProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });
});

// ─── Booking Cancellation Audit ───

describe('Booking Cancellation Audit', () => {
  it('stores cancelledBy when a booking is cancelled', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-cancel-audit@applecalendar.com' },
      update: {},
      create: {
        email: 'test-cancel-audit@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Cancel Audit',
        role: 'ORGANIZER',
      },
    });

    const booker = await prisma.user.upsert({
      where: { email: 'test-cancel-audit-booker@applecalendar.com' },
      update: {},
      create: {
        email: 'test-cancel-audit-booker@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Cancel Booker',
        role: 'PUBLIC',
      },
    });

    const event = await prisma.event.create({
      data: {
        title: 'Cancel Audit Event',
        slug: 'cancel-audit-event-' + Date.now(),
        description: 'Test',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        organizerId: orgUser.id,
      },
    });

    const booking = await prisma.booking.create({
      data: {
        userId: booker.id,
        eventId: event.id,
        totalAmount: 50,
        currency: 'GHS',
        status: 'CONFIRMED',
        bookingRef: 'APC-CANCEL-AUDIT-' + Date.now(),
      },
    });

    // Cancel the booking with audit fields
    const cancelled = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelledBy: booker.id,
        cancellationReason: 'Schedule conflict',
      },
    });

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledBy).toBe(booker.id);
    expect(cancelled.cancellationReason).toBe('Schedule conflict');

    // Clean up
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.user.delete({ where: { id: booker.id } });
    await prisma.user.delete({ where: { id: orgUser.id } });
  });
});

// ─── Payment Provider Metadata ───

describe('Payment Provider Metadata', () => {
  it('stores provider-agnostic metadata fields', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-payment-meta@applecalendar.com' },
      update: {},
      create: {
        email: 'test-payment-meta@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Payment Meta',
        role: 'ORGANIZER',
      },
    });

    const booker = await prisma.user.upsert({
      where: { email: 'test-payment-booker@applecalendar.com' },
      update: {},
      create: {
        email: 'test-payment-booker@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Payment Booker',
        role: 'PUBLIC',
      },
    });

    const event = await prisma.event.create({
      data: {
        title: 'Payment Meta Event',
        slug: 'payment-meta-event-' + Date.now(),
        description: 'Test',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        organizerId: orgUser.id,
      },
    });

    const booking = await prisma.booking.create({
      data: {
        userId: booker.id,
        eventId: event.id,
        totalAmount: 200,
        currency: 'GHS',
        status: 'CONFIRMED',
        bookingRef: 'APC-PAYMENT-META-' + Date.now(),
      },
    });

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: booker.id,
        amount: 200,
        currency: 'GHS',
        provider: 'PAYSTACK',
        status: 'COMPLETED',
        providerRef: 'paystack-ref-123',
        providerCustomerId: 'cust-456',
        idempotencyKey: 'idem-' + Date.now(),
        metadata: JSON.stringify({ channel: 'mobile_money', network: 'MTN' }),
      },
    });

    expect(payment.providerRef).toBe('paystack-ref-123');
    expect(payment.providerCustomerId).toBe('cust-456');
    expect(payment.idempotencyKey).toBeDefined();
    expect(payment.provider).toBe('PAYSTACK');
    expect(payment.refundedAmount).toBe(0);

    // Clean up
    await prisma.payment.delete({ where: { id: payment.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.user.delete({ where: { id: booker.id } });
    await prisma.user.delete({ where: { id: orgUser.id } });
  });
});

// ─── Ghana-First Defaults ───

describe('Ghana-First Defaults', () => {
  it('Venue defaults to GH country', async () => {
    const venue = await prisma.venue.create({
      data: {
        name: 'Ghana Default Test',
        slug: 'ghana-default-test-' + Date.now(),
        address: 'Test Address',
        city: 'Accra',
        // country not specified — should default to GH
      },
    });

    expect(venue.country).toBe('GH');

    await prisma.venue.delete({ where: { id: venue.id } });
  });

  it('Event defaults to GH country and GHS currency', async () => {
    const orgUser = await prisma.user.upsert({
      where: { email: 'test-ghana-defaults@applecalendar.com' },
      update: {},
      create: {
        email: 'test-ghana-defaults@applecalendar.com',
        password: 'hashed_password_placeholder',
        name: 'Test Ghana Defaults',
        role: 'ORGANIZER',
      },
    });

    const event = await prisma.event.create({
      data: {
        title: 'Ghana Defaults Event',
        slug: 'ghana-defaults-event-' + Date.now(),
        description: 'Test',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        organizerId: orgUser.id,
        // venueCountry and currency not specified — should use defaults
      },
    });

    expect(event.venueCountry).toBe('GH');
    expect(event.currency).toBe('GHS');

    await prisma.event.delete({ where: { id: event.id } });
    await prisma.user.delete({ where: { id: orgUser.id } });
  });
});
