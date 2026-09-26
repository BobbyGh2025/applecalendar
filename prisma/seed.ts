import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

// ─── Development-only credentials (DO NOT use in production) ───
// admin@applecalendar.com  →  AdminPass2025!
// organizer@events.com      →  OrgPass2025!
// pending@events.com        →  OrgPass2025!
// tech@events.com           →  OrgPass2025!
// staff@events.com          →  StaffPass2025!
// user@test.com             →  UserPass2025!
// ───────────────────────────────────────────────────────────────

const DEV_CREDENTIALS = {
  superAdmin: 'AdminPass2025!',
  organizer: 'OrgPass2025!',
  staff: 'StaffPass2025!',
  public: 'UserPass2025!',
} as const;

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Create Super Admin
  const superAdminPassword = await hashPassword(DEV_CREDENTIALS.superAdmin);
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@applecalendar.com' },
    update: {},
    create: {
      email: 'admin@applecalendar.com',
      password: superAdminPassword,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
      emailVerified: new Date(),
    },
  });
  console.log('✅ Super Admin created:', superAdmin.email);

  // 2. Create Organizer users
  const orgPassword = await hashPassword(DEV_CREDENTIALS.organizer);
  const organizer1 = await prisma.user.upsert({
    where: { email: 'organizer@events.com' },
    update: {},
    create: {
      email: 'organizer@events.com',
      password: orgPassword,
      name: 'Sarah Mitchell',
      role: 'ORGANIZER',
      bio: 'Professional event organizer with 10+ years experience',
      phone: '+1-555-0101',
      isActive: true,
      emailVerified: new Date(),
    },
  });

  const organizer2 = await prisma.user.upsert({
    where: { email: 'tech@events.com' },
    update: {},
    create: {
      email: 'tech@events.com',
      password: orgPassword,
      name: 'Tech Events Co.',
      role: 'ORGANIZER',
      bio: 'Leading technology conference organizers',
      phone: '+1-555-0202',
      isActive: true,
      emailVerified: new Date(),
    },
  });

  const organizer3 = await prisma.user.upsert({
    where: { email: 'pending@events.com' },
    update: {},
    create: {
      email: 'pending@events.com',
      password: orgPassword,
      name: 'Pending Events Co.',
      role: 'ORGANIZER',
      bio: 'A new organizer awaiting approval',
      phone: '+1-555-0505',
      isActive: true,
      emailVerified: new Date(),
    },
  });

  const staffPassword = await hashPassword(DEV_CREDENTIALS.staff);
  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@events.com' },
    update: {},
    create: {
      email: 'staff@events.com',
      password: staffPassword,
      name: 'James Wilson',
      role: 'STAFF',
      phone: '+1-555-0303',
      isActive: true,
      emailVerified: new Date(),
    },
  });

  const publicPassword = await hashPassword(DEV_CREDENTIALS.public);
  const publicUser = await prisma.user.upsert({
    where: { email: 'user@test.com' },
    update: {},
    create: {
      email: 'user@test.com',
      password: publicPassword,
      name: 'Alex Johnson',
      role: 'PUBLIC',
      phone: '+1-555-0404',
      isActive: true,
      emailVerified: new Date(),
    },
  });

  console.log('✅ Users created');

  // 2.5 Create OrganizerProfiles for organizer users
  const orgProfile1 = await prisma.organizerProfile.upsert({
    where: { userId: organizer1.id },
    update: {},
    create: {
      userId: organizer1.id,
      organizationName: 'Mitchell Events',
      slug: 'mitchell-events',
      description: 'Premium event organization with 10+ years of experience producing world-class events.',
      logo: 'https://images.unsplash.com/photo-1560473635-8e3d3e3e3e3e?w=200&h=200&fit=crop',
      website: 'https://mitchell-events.example.com',
      contactEmail: 'info@mitchell-events.example.com',
      phone: '+1-555-0101',
      city: 'San Francisco',
      state: 'CA',
      country: 'US',
      socialLinks: JSON.stringify({ twitter: '@mitchell_events', linkedin: 'mitchell-events' }),
      isVerified: true,
      approvalStatus: 'APPROVED',
      status: 'ACTIVE',
    },
  });

  const orgProfile2 = await prisma.organizerProfile.upsert({
    where: { userId: organizer2.id },
    update: {},
    create: {
      userId: organizer2.id,
      organizationName: 'Tech Events Co.',
      slug: 'tech-events-co',
      description: 'Leading technology conference organizers and workshop providers.',
      website: 'https://tech-events.example.com',
      contactEmail: 'info@tech-events.example.com',
      phone: '+1-555-0202',
      city: 'New York',
      state: 'NY',
      country: 'US',
      socialLinks: JSON.stringify({ twitter: '@tech_events_co', linkedin: 'tech-events-co' }),
      isVerified: true,
      approvalStatus: 'APPROVED',
      status: 'ACTIVE',
    },
  });

  const orgProfile3 = await prisma.organizerProfile.upsert({
    where: { userId: organizer3.id },
    update: {},
    create: {
      userId: organizer3.id,
      organizationName: 'Pending Events Co.',
      slug: 'pending-events-co',
      description: 'A new event organizer awaiting admin approval.',
      website: 'https://pending-events.example.com',
      contactEmail: 'info@pending-events.example.com',
      phone: '+1-555-0505',
      city: 'Chicago',
      state: 'IL',
      country: 'US',
      isVerified: false,
      approvalStatus: 'PENDING',
      status: 'PENDING_APPROVAL',
    },
  });

  console.log('✅ Organizer Profiles created');

  // 2.6 Create OrganizerMembership for staff user as member of organizer1's org
  await prisma.organizerMembership.upsert({
    where: { id: 'membership-staff-1' },
    update: {},
    create: {
      id: 'membership-staff-1',
      organizerId: orgProfile1.id,
      userId: staffUser.id,
      role: 'STAFF',
      permissions: JSON.stringify(['events.view', 'tickets.view', 'bookings.view', 'analytics.view', 'organizer.profile']),
      status: 'ACTIVE',
      invitedByEmail: 'organizer@events.com',
    },
  });

  console.log('✅ Organizer Memberships created');

  // 3. Create Categories
  const categories = [
    { name: 'Music', slug: 'music', icon: 'Music', color: '#ec4899' },
    { name: 'Technology', slug: 'technology', icon: 'Laptop', color: '#6366f1' },
    { name: 'Business', slug: 'business', icon: 'Briefcase', color: '#f59e0b' },
    { name: 'Sports', slug: 'sports', icon: 'Trophy', color: '#10b981' },
    { name: 'Arts', slug: 'arts', icon: 'Palette', color: '#f43f5e' },
    { name: 'Food & Drink', slug: 'food-drink', icon: 'UtensilsCrossed', color: '#f97316' },
    { name: 'Health', slug: 'health', icon: 'Heart', color: '#ef4444' },
    { name: 'Education', slug: 'education', icon: 'GraduationCap', color: '#8b5cf6' },
    { name: 'Community', slug: 'community', icon: 'Users', color: '#14b8a6' },
    { name: 'Networking', slug: 'networking', icon: 'Network', color: '#0ea5e9' },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: { ...cat, sortOrder: categories.indexOf(cat) },
    });
  }
  console.log('✅ Categories created');

  // 4. Create Tags
  const tags = [
    'free', 'paid', 'outdoor', 'indoor', 'virtual',
    'family-friendly', '18-plus', 'live-music', 'workshop',
    'conference', 'meetup', 'festival', 'seminar',
    'networking', 'hackathon', 'bootcamp', 'webinar',
  ];
  for (const tag of tags) {
    await prisma.tag.upsert({
      where: { slug: tag },
      update: {},
      create: { name: tag.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), slug: tag },
    });
  }
  console.log('✅ Tags created');

  // 5. Create Subscription Plans (Phase 4A — GHS pricing, full feature set)
  const plans = [
    {
      name: 'Free', slug: 'free',
      description: 'Get started with basic event creation',
      price: 0, interval: 'MONTHLY', currency: 'GHS',
      maxEvents: 3, maxTicketsPerEvent: 50, maxTicketTypesPerEvent: 2,
      maxStaff: 0, maxMediaPerEvent: 3, maxAttendeesTotal: 500,
      canAdvertise: false, canCustomBranding: false, canApiAccess: false,
      analyticsLevel: 'BASIC', trialDays: 0,
      features: JSON.stringify(['3 events/month', '50 tickets/event', '2 ticket types', 'Basic analytics', 'Email support']),
      sortOrder: 0,
    },
    {
      name: 'Starter', slug: 'starter',
      description: 'Perfect for growing event organizers',
      price: 99, interval: 'MONTHLY', currency: 'GHS',
      maxEvents: 10, maxTicketsPerEvent: 500, maxTicketTypesPerEvent: 5,
      maxStaff: 2, maxMediaPerEvent: 10, maxAttendeesTotal: 2000,
      canAdvertise: false, canCustomBranding: false, canApiAccess: false,
      analyticsLevel: 'ADVANCED', trialDays: 14,
      features: JSON.stringify(['10 events/month', '500 tickets/event', '5 ticket types', '2 staff seats', 'Advanced analytics', 'Priority support', 'QR code tickets', '14-day trial']),
      sortOrder: 1,
    },
    {
      name: 'Professional', slug: 'professional',
      description: 'For professional event management',
      price: 299, interval: 'MONTHLY', currency: 'GHS',
      maxEvents: 50, maxTicketsPerEvent: 5000, maxTicketTypesPerEvent: 10,
      maxStaff: 5, maxMediaPerEvent: 20, maxAttendeesTotal: 10000,
      canAdvertise: true, canCustomBranding: true, canApiAccess: true,
      analyticsLevel: 'FULL', trialDays: 14,
      features: JSON.stringify(['50 events/month', '5000 tickets/event', '10 ticket types', '5 staff seats', 'Full analytics suite', 'Custom branding', 'Dedicated support', 'QR code tickets', 'PDF tickets', 'Advertisement slots', 'API access', '14-day trial']),
      sortOrder: 2,
    },
    {
      name: 'Enterprise', slug: 'enterprise',
      description: 'Unlimited events for large organizations',
      price: 799, interval: 'MONTHLY', currency: 'GHS',
      maxEvents: 999, maxTicketsPerEvent: 50000, maxTicketTypesPerEvent: 25,
      maxStaff: 50, maxMediaPerEvent: 50, maxAttendeesTotal: 50000,
      canAdvertise: true, canCustomBranding: true, canApiAccess: true,
      analyticsLevel: 'FULL', trialDays: 30,
      features: JSON.stringify(['Unlimited events', '50000 tickets/event', '25 ticket types', '50 staff seats', 'Full analytics suite', 'White-label branding', '24/7 dedicated support', 'All ticket features', 'Advertisement management', 'API access', 'Custom integrations', 'SLA guarantee', '30-day trial']),
      sortOrder: 3,
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { slug: plan.slug },
      update: {},
      create: plan,
    });
  }
  console.log('✅ Subscription Plans created');

  // 5.5 Create OrganizerSubscriptions (Phase 4A)
  const professionalPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'professional' } });
  const starterPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'starter' } });

  if (professionalPlan) {
    await prisma.organizerSubscription.upsert({
      where: { organizerId: orgProfile1.id },
      update: {},
      create: {
        organizerId: orgProfile1.id,
        planId: professionalPlan.id,
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isInTrial: false,
        autoRenew: true,
        billingProvider: 'MANUAL',
        paymentStatus: 'CURRENT',
      },
    });
  }

  if (starterPlan) {
    await prisma.organizerSubscription.upsert({
      where: { organizerId: orgProfile2.id },
      update: {},
      create: {
        organizerId: orgProfile2.id,
        planId: starterPlan.id,
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isInTrial: false,
        autoRenew: true,
        billingProvider: 'MANUAL',
        paymentStatus: 'CURRENT',
      },
    });
  }

  // Organizer3 (pending) gets the Free plan
  const freePlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'free' } });
  if (freePlan) {
    await prisma.organizerSubscription.upsert({
      where: { organizerId: orgProfile3.id },
      update: {},
      create: {
        organizerId: orgProfile3.id,
        planId: freePlan.id,
        status: 'ACTIVE',
        startDate: new Date(),
        isInTrial: false,
        autoRenew: false,
        billingProvider: 'MANUAL',
        paymentStatus: 'CURRENT',
      },
    });
  }
  console.log('✅ Organizer Subscriptions created');

  // 5.6 Create Venues (Phase 4A — Ghana-based sample venues)
  const venues = [
    {
      name: 'Accra International Conference Centre',
      slug: 'accra-international-conference-centre',
      description: 'Ghana\'s premier conference venue, hosting major international events, summits, and exhibitions.',
      address: 'Independence Ave',
      city: 'Accra',
      state: 'Greater Accra',
      country: 'GH',
      lat: 5.556,
      lng: -0.184,
      capacity: 1700,
      amenities: JSON.stringify(['parking', 'wifi', 'ac', 'catering', 'stage', 'sound_system', 'projector', 'translation_booth']),
      contactName: 'AICC Booking Office',
      contactEmail: 'bookings@aicc.gov.gh',
      contactPhone: '+233-21-66-5464',
      website: 'https://aicc.gov.gh',
      isPublic: true,
    },
    {
      name: 'National Theatre of Ghana',
      slug: 'national-theatre-of-ghana',
      description: 'An iconic performing arts venue on Independence Avenue, hosting concerts, plays, and cultural events.',
      address: 'Independence Ave',
      city: 'Accra',
      state: 'Greater Accra',
      country: 'GH',
      lat: 5.548,
      lng: -0.186,
      capacity: 1500,
      amenities: JSON.stringify(['parking', 'ac', 'stage', 'sound_system', 'lighting', 'backstage', 'dressing_rooms']),
      contactName: 'National Theatre Box Office',
      contactEmail: 'info@nationaltheatre.gov.gh',
      contactPhone: '+233-21-66-2849',
      isPublic: true,
    },
    {
      name: 'Kempinski Hotel Gold Coast City',
      slug: 'kempinski-hotel-gold-coast-city',
      description: 'Luxury hotel with world-class event spaces for corporate meetings, galas, and intimate gatherings.',
      address: 'Airport Residential Area',
      city: 'Accra',
      state: 'Greater Accra',
      country: 'GH',
      lat: 5.605,
      lng: -0.172,
      capacity: 500,
      amenities: JSON.stringify(['parking', 'wifi', 'ac', 'catering', 'stage', 'sound_system', 'projector', 'valet', 'accommodation']),
      contactName: 'Events Team',
      contactEmail: 'events.accra@kempinski.com',
      contactPhone: '+233-30-27-80900',
      website: 'https://kempinski.com/accra',
      isPublic: true,
    },
    {
      name: 'University of Ghana - Great Hall',
      slug: 'university-of-ghana-great-hall',
      description: 'The historic Great Hall at Legon, ideal for academic conferences, convocations, and large-scale seminars.',
      address: 'Legon',
      city: 'Accra',
      state: 'Greater Accra',
      country: 'GH',
      lat: 5.650,
      lng: -0.186,
      capacity: 1000,
      amenities: JSON.stringify(['parking', 'wifi', 'ac', 'stage', 'sound_system', 'projector']),
      contactName: 'UG Events Office',
      contactEmail: 'events@ug.edu.gh',
      contactPhone: '+233-30-25-50462',
      website: 'https://ug.edu.gh',
      isPublic: true,
    },
  ];

  for (const venue of venues) {
    await prisma.venue.upsert({
      where: { slug: venue.slug },
      update: {},
      create: venue,
    });
  }
  console.log('✅ Venues created');

  // 6. Create subscriptions for organizers (legacy User-level subscriptions)
  const legacyProPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'professional' } });
  const legacyStarterPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'starter' } });
  if (legacyProPlan && legacyStarterPlan) {
    await prisma.subscription.upsert({
      where: { id: 'sub-1' },
      update: {},
      create: {
        id: 'sub-1', userId: organizer1.id, planId: legacyProPlan.id,
        status: 'ACTIVE', startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), autoRenew: true,
      },
    });
    await prisma.subscription.upsert({
      where: { id: 'sub-2' },
      update: {},
      create: {
        id: 'sub-2', userId: organizer2.id, planId: legacyStarterPlan.id,
        status: 'ACTIVE', startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), autoRenew: true,
      },
    });
  }
  console.log('✅ Subscriptions created');

  // 7. Create sample events
  const techCat = await prisma.category.findUnique({ where: { slug: 'technology' } });
  const musicCat = await prisma.category.findUnique({ where: { slug: 'music' } });
  const businessCat = await prisma.category.findUnique({ where: { slug: 'business' } });
  const foodCat = await prisma.category.findUnique({ where: { slug: 'food-drink' } });
  const artsCat = await prisma.category.findUnique({ where: { slug: 'arts' } });
  const sportsCat = await prisma.category.findUnique({ where: { slug: 'sports' } });

  const now = new Date();
  const events = [
    {
      id: 'evt-1', title: 'Global Tech Summit 2025', slug: 'global-tech-summit-2025',
      description: 'Join the world\'s leading technologists for three days of keynotes, workshops, and networking. Featuring speakers from top tech companies including Google, Meta, and Apple. Explore the latest in AI, cloud computing, cybersecurity, and more.',
      shortDescription: 'Three days of keynotes, workshops, and networking with world-class technologists.',
      coverImage: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&h=400&fit=crop',
      startDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 32 * 24 * 60 * 60 * 1000),
      startTime: '09:00', endTime: '18:00', timezone: 'America/New_York',
      venueName: 'Moscone Center', venueAddress: '747 Howard St',
      venueCity: 'San Francisco', venueState: 'CA', venueCountry: 'US',
      venueLat: 37.7842, venueLng: -122.4016,
      isVirtual: false, capacity: 5000, status: 'PUBLISHED',
      isFeatured: true, isPaid: true, currency: 'USD',
      organizerId: organizer1.id, categoryId: techCat?.id,
    },
    {
      id: 'evt-2', title: 'Summer Music Festival', slug: 'summer-music-festival-2025',
      description: 'An unforgettable outdoor music festival featuring over 50 artists across 4 stages. From indie rock to electronic, there\'s something for every music lover. Food trucks, art installations, and camping available.',
      shortDescription: 'Over 50 artists across 4 stages in an unforgettable outdoor experience.',
      coverImage: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&h=400&fit=crop',
      startDate: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 47 * 24 * 60 * 60 * 1000),
      startTime: '12:00', endTime: '23:00', timezone: 'America/New_York',
      venueName: 'Central Park Great Lawn', venueAddress: 'Central Park',
      venueCity: 'New York', venueState: 'NY', venueCountry: 'US',
      venueLat: 40.7829, venueLng: -73.9654,
      isVirtual: false, capacity: 20000, status: 'PUBLISHED',
      isFeatured: true, isPaid: true, currency: 'USD',
      organizerId: organizer1.id, categoryId: musicCat?.id,
    },
    {
      id: 'evt-3', title: 'AI & Machine Learning Workshop', slug: 'ai-ml-workshop-2025',
      description: 'A hands-on workshop covering the latest techniques in AI and machine learning. Learn from industry experts about LLMs, computer vision, and practical ML deployment strategies.',
      shortDescription: 'Hands-on workshop covering latest AI and machine learning techniques.',
      coverImage: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&h=400&fit=crop',
      startDate: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 16 * 24 * 60 * 60 * 1000),
      startTime: '10:00', endTime: '17:00', timezone: 'America/New_York',
      venueName: 'TechHub NYC', venueAddress: '122 W 26th St',
      venueCity: 'New York', venueState: 'NY', venueCountry: 'US',
      venueLat: 40.7465, venueLng: -73.9969,
      isVirtual: false, capacity: 200, status: 'PUBLISHED',
      isFeatured: false, isPaid: true, currency: 'USD',
      organizerId: organizer2.id, categoryId: techCat?.id,
    },
    {
      id: 'evt-4', title: 'Startup Pitch Night', slug: 'startup-pitch-night-2025',
      description: 'Watch 10 exciting startups pitch their ideas to a panel of top VCs. Network with founders, investors, and fellow entrepreneurs. Free drinks and appetizers included.',
      shortDescription: '10 startups pitch to top VCs. Network with founders and investors.',
      coverImage: 'https://images.unsplash.com/photo-1556761175-4b46a572b786?w=800&h=400&fit=crop',
      startDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      startTime: '18:30', endTime: '21:30', timezone: 'America/New_York',
      venueName: 'WeWork SoHo', venueAddress: '69 Charlton St',
      venueCity: 'New York', venueState: 'NY', venueCountry: 'US',
      venueLat: 40.7236, venueLng: -74.0018,
      isVirtual: false, capacity: 150, status: 'PUBLISHED',
      isFeatured: false, isPaid: false, currency: 'USD',
      organizerId: organizer2.id, categoryId: businessCat?.id,
    },
    {
      id: 'evt-5', title: 'International Food & Wine Expo', slug: 'food-wine-expo-2025',
      description: 'Explore cuisines from around the world at this spectacular food and wine expo. Sample dishes from 50+ restaurants, attend cooking demonstrations, and enjoy wine tastings from premium vineyards.',
      shortDescription: 'Cuisines from around the world with 50+ restaurants and wine tastings.',
      coverImage: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&h=400&fit=crop',
      startDate: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 62 * 24 * 60 * 60 * 1000),
      startTime: '11:00', endTime: '20:00', timezone: 'America/New_York',
      venueName: 'Javits Center', venueAddress: '429 11th Ave',
      venueCity: 'New York', venueState: 'NY', venueCountry: 'US',
      venueLat: 40.7575, venueLng: -74.0028,
      isVirtual: false, capacity: 10000, status: 'PUBLISHED',
      isFeatured: true, isPaid: true, currency: 'USD',
      organizerId: organizer1.id, categoryId: foodCat?.id,
    },
    {
      id: 'evt-6', title: 'Contemporary Art Exhibition', slug: 'contemporary-art-exhibition-2025',
      description: 'A stunning exhibition featuring works from 30+ contemporary artists. Explore paintings, sculptures, digital art, and immersive installations.',
      shortDescription: 'Works from 30+ contemporary artists in a stunning exhibition.',
      coverImage: 'https://images.unsplash.com/photo-1531243269054-5ebf6f34081e?w=800&h=400&fit=crop',
      startDate: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 50 * 24 * 60 * 60 * 1000),
      startTime: '10:00', endTime: '20:00', timezone: 'America/New_York',
      venueName: 'MoMA PS1', venueAddress: '22-25 Jackson Ave',
      venueCity: 'New York', venueState: 'NY', venueCountry: 'US',
      venueLat: 40.7455, venueLng: -73.9473,
      isVirtual: false, capacity: 500, status: 'PUBLISHED',
      isFeatured: false, isPaid: true, currency: 'USD',
      organizerId: organizer1.id, categoryId: artsCat?.id,
    },
    {
      id: 'evt-7', title: 'City Marathon 2025', slug: 'city-marathon-2025',
      description: 'The annual city marathon returns! Choose from full marathon, half marathon, or 5K fun run. All fitness levels welcome.',
      shortDescription: 'Annual city marathon - full, half, and 5K options for all levels.',
      coverImage: 'https://images.unsplash.com/photo-1513593771513-7b58b6c4af38?w=800&h=400&fit=crop',
      startDate: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000),
      startTime: '06:00', endTime: '14:00', timezone: 'America/New_York',
      venueName: 'Central Park', venueAddress: 'Central Park',
      venueCity: 'New York', venueState: 'NY', venueCountry: 'US',
      venueLat: 40.7829, venueLng: -73.9654,
      isVirtual: false, capacity: 30000, status: 'PUBLISHED',
      isFeatured: false, isPaid: true, currency: 'USD',
      organizerId: organizer2.id, categoryId: sportsCat?.id,
    },
    {
      id: 'evt-8', title: 'Virtual Blockchain Conference', slug: 'virtual-blockchain-conference-2025',
      description: 'The premier virtual conference on blockchain technology, DeFi, and Web3. Attend from anywhere in the world.',
      shortDescription: 'Premier virtual blockchain and Web3 conference - attend from anywhere.',
      coverImage: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&h=400&fit=crop',
      startDate: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 26 * 24 * 60 * 60 * 1000),
      startTime: '09:00', endTime: '18:00', timezone: 'UTC',
      venueName: 'Online Event', isVirtual: true,
      virtualUrl: 'https://conference.example.com',
      capacity: 10000, status: 'PUBLISHED',
      isFeatured: false, isPaid: true, currency: 'USD',
      organizerId: organizer2.id, categoryId: techCat?.id,
    },
    {
      id: 'evt-9', title: 'Design Thinking Workshop', slug: 'design-thinking-workshop-2025',
      description: 'Learn design thinking methodologies from industry experts.',
      shortDescription: 'Master design thinking with hands-on exercises.',
      startDate: new Date(now.getTime() + 50 * 24 * 60 * 60 * 1000),
      startTime: '10:00', endTime: '16:00',
      venueName: 'Design Studio', venueCity: 'New York', venueState: 'NY', venueCountry: 'US',
      capacity: 50, status: 'DRAFT',
      organizerId: organizer1.id, categoryId: artsCat?.id,
    },
    {
      id: 'evt-10', title: 'Yoga & Wellness Retreat', slug: 'yoga-wellness-retreat-2025',
      description: 'A weekend of yoga, meditation, and wellness workshops in a beautiful setting.',
      shortDescription: 'Weekend yoga and wellness retreat.',
      startDate: new Date(now.getTime() + 55 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 57 * 24 * 60 * 60 * 1000),
      startTime: '07:00', endTime: '20:00',
      venueName: 'Mountain View Resort', venueCity: 'Boulder', venueState: 'CO', venueCountry: 'US',
      capacity: 80, status: 'PENDING',
      organizerId: organizer1.id, categoryId: sportsCat?.id,
    },
  ];

  for (const evt of events) {
    await prisma.event.upsert({
      where: { slug: evt.slug },
      update: {},
      create: evt,
    });
  }
  console.log('✅ Events created');

  // 8. Create ticket types
  const ticketTypesData = [
    { eventId: 'evt-1', name: 'General Admission', price: 299, quantity: 3000, soldCount: 1847 },
    { eventId: 'evt-1', name: 'VIP Pass', price: 799, quantity: 500, soldCount: 312 },
    { eventId: 'evt-1', name: 'Student Discount', price: 149, quantity: 1000, soldCount: 623 },
    { eventId: 'evt-2', name: 'Day Pass', price: 89, quantity: 10000, soldCount: 5621 },
    { eventId: 'evt-2', name: 'Weekend Pass', price: 159, quantity: 8000, soldCount: 4230 },
    { eventId: 'evt-2', name: 'VIP Camping', price: 299, quantity: 2000, soldCount: 1890 },
    { eventId: 'evt-3', name: 'Standard', price: 199, quantity: 150, soldCount: 89 },
    { eventId: 'evt-3', name: 'Premium (with laptop)', price: 349, quantity: 50, soldCount: 38 },
    { eventId: 'evt-4', name: 'General', price: 0, quantity: 150, soldCount: 112 },
    { eventId: 'evt-5', name: 'Single Day', price: 45, quantity: 5000, soldCount: 2100 },
    { eventId: 'evt-5', name: 'Full Pass', price: 79, quantity: 5000, soldCount: 1890 },
    { eventId: 'evt-6', name: 'Adult', price: 25, quantity: 400, soldCount: 156 },
    { eventId: 'evt-6', name: 'Student', price: 15, quantity: 100, soldCount: 67 },
    { eventId: 'evt-7', name: 'Full Marathon', price: 75, quantity: 15000, soldCount: 8900 },
    { eventId: 'evt-7', name: 'Half Marathon', price: 55, quantity: 10000, soldCount: 6700 },
    { eventId: 'evt-7', name: '5K Fun Run', price: 30, quantity: 5000, soldCount: 3400 },
    { eventId: 'evt-8', name: 'Standard', price: 49, quantity: 8000, soldCount: 3200 },
    { eventId: 'evt-8', name: 'Premium', price: 149, quantity: 2000, soldCount: 890 },
  ];

  for (const tt of ticketTypesData) {
    await prisma.ticketType.create({
      data: { eventId: tt.eventId, name: tt.name, price: tt.price, currency: 'USD', quantity: tt.quantity, soldCount: tt.soldCount },
    });
  }
  console.log('✅ Ticket Types created');

  // 9. Create bookings
  const bookingsData = [
    { userId: publicUser.id, eventId: 'evt-4', status: 'CONFIRMED', amount: 0 },
    { userId: publicUser.id, eventId: 'evt-1', status: 'CONFIRMED', amount: 299 },
    { userId: publicUser.id, eventId: 'evt-2', status: 'PENDING', amount: 159 },
  ];

  for (let i = 0; i < bookingsData.length; i++) {
    const b = bookingsData[i];
    const bookingRef = `APC-${Date.now()}-${i}`;
    const booking = await prisma.booking.create({
      data: { userId: b.userId, eventId: b.eventId, totalAmount: b.amount, currency: 'USD', status: b.status, bookingRef },
    });
    const ticketType = await prisma.ticketType.findFirst({ where: { eventId: b.eventId } });
    if (ticketType) {
      await prisma.ticket.create({
        data: { ticketTypeId: ticketType.id, bookingId: booking.id, qrCode: `QR-${bookingRef}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`, status: b.status === 'CONFIRMED' ? 'VALID' : 'VALID' },
      });
    }
    if (b.amount > 0) {
      await prisma.payment.create({
        data: { bookingId: booking.id, userId: b.userId, amount: b.amount, currency: 'USD', method: 'STRIPE', status: b.status === 'CONFIRMED' ? 'COMPLETED' : 'PENDING', transactionId: `txn_${Math.random().toString(36).substring(2, 15)}` },
      });
    }
  }
  console.log('✅ Bookings created');

  // 10. Create reviews
  try { await prisma.review.create({ data: { userId: publicUser.id, eventId: 'evt-4', rating: 5, comment: 'Amazing event! Great networking opportunities and the pitches were fantastic.' } }); } catch {}
  try { await prisma.review.create({ data: { userId: publicUser.id, eventId: 'evt-1', rating: 4, comment: 'Well organized conference with great speakers. Looking forward to next year.' } }); } catch {}
  console.log('✅ Reviews created');

  // 11. Create event analytics
  const publishedEvents = await prisma.event.findMany({ where: { status: 'PUBLISHED' } });
  for (const event of publishedEvents) {
    for (let d = 0; d < 30; d++) {
      const date = new Date(now.getTime() - (29 - d) * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      await prisma.eventAnalytics.upsert({
        where: { eventId_date: { eventId: event.id, date: dateStr } },
        update: {},
        create: {
          eventId: event.id, date: dateStr,
          views: Math.floor(Math.random() * 500) + 50,
          clicks: Math.floor(Math.random() * 100) + 10,
          bookings: Math.floor(Math.random() * 20) + 1,
          revenue: Math.floor(Math.random() * 5000) + 100,
        },
      });
    }
  }
  console.log('✅ Analytics created');

  // 12. Create advertisements (Phase 4A — with organizerId, approvalStatus, reviewedBy)
  try {
    await prisma.advertisement.create({
      data: {
        title: 'Premium Event Promotion',
        imageUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&h=200&fit=crop',
        linkUrl: 'evt-1', position: 'BANNER', status: 'ACTIVE',
        impressions: 15420, clicks: 892,
        startDate: new Date(), endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        eventId: 'evt-1', advertiserId: organizer1.id,
        organizerId: orgProfile1.id, approvalStatus: 'APPROVED', reviewedBy: superAdmin.id,
      },
    });
  } catch {}
  try {
    await prisma.advertisement.create({
      data: {
        title: 'Summer Festival Early Bird',
        imageUrl: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=300&h=250&fit=crop',
        linkUrl: 'evt-2', position: 'SIDEBAR', status: 'ACTIVE',
        impressions: 8930, clicks: 456,
        startDate: new Date(), endDate: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000),
        eventId: 'evt-2', advertiserId: organizer1.id,
        organizerId: orgProfile1.id, approvalStatus: 'APPROVED', reviewedBy: superAdmin.id,
      },
    });
  } catch {}
  console.log('✅ Advertisements created');

  // 13. Create notifications
  const notifs = [
    { userId: publicUser.id, title: 'Booking Confirmed', message: 'Your booking for Global Tech Summit 2025 has been confirmed!', type: 'BOOKING', link: 'evt-1' },
    { userId: publicUser.id, title: 'New Event Nearby', message: 'A new event "Startup Pitch Night" has been published near you!', type: 'EVENT_UPDATE', link: 'evt-4' },
    { userId: organizer1.id, title: 'New Booking', message: 'Someone just booked a ticket for Global Tech Summit 2025.', type: 'BOOKING', link: 'evt-1' },
    { userId: organizer1.id, title: 'Subscription Renewing', message: 'Your Professional plan subscription will renew in 5 days.', type: 'SYSTEM', link: '' },
    { userId: publicUser.id, title: 'Payment Received', message: 'Payment of $299.00 for Global Tech Summit 2025 received.', type: 'PAYMENT', link: 'evt-1' },
  ];
  for (const n of notifs) { try { await prisma.notification.create({ data: n }); } catch {} }
  console.log('✅ Notifications created');

  // 14. System settings
  const settings = [
    { key: 'platform_name', value: 'AppleCalendar' },
    { key: 'platform_fee_percent', value: '5' },
    { key: 'default_currency', value: 'USD' },
    { key: 'support_email', value: 'support@applecalendar.com' },
  ];
  for (const s of settings) { try { await prisma.systemSetting.create({ data: s }); } catch {} }
  console.log('✅ System settings created');

  console.log('\n🎉 Seed completed successfully!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
