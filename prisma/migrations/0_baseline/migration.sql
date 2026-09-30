-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "phone" TEXT,
    "bio" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PUBLIC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CHECKIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "StaffAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "interval" TEXT NOT NULL DEFAULT 'MONTHLY',
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "maxEvents" INTEGER NOT NULL DEFAULT 5,
    "maxTicketsPerEvent" INTEGER NOT NULL DEFAULT 100,
    "maxTicketTypesPerEvent" INTEGER NOT NULL DEFAULT 3,
    "maxStaff" INTEGER NOT NULL DEFAULT 1,
    "maxMediaPerEvent" INTEGER NOT NULL DEFAULT 3,
    "maxAttendeesTotal" INTEGER NOT NULL DEFAULT 500,
    "canAdvertise" BOOLEAN NOT NULL DEFAULT false,
    "canCustomBranding" BOOLEAN NOT NULL DEFAULT false,
    "canApiAccess" BOOLEAN NOT NULL DEFAULT false,
    "analyticsLevel" TEXT NOT NULL DEFAULT 'BASIC',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "features" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE RESTRICT
);

-- CreateTable
CREATE TABLE "OrganizerSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "isInTrial" BOOLEAN NOT NULL DEFAULT false,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "billingProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    "billingProviderRef" TEXT,
    "billingCustomerId" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'CURRENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizerSubscription_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "OrganizerProfile" ("id") ON DELETE CASCADE,
    CONSTRAINT "OrganizerSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE RESTRICT
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT,
    "coverImage" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endTime" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "venueName" TEXT,
    "venueAddress" TEXT,
    "venueCity" TEXT,
    "venueState" TEXT,
    "venueCountry" TEXT NOT NULL DEFAULT 'GH',
    "venueLat" DOUBLE PRECISION,
    "venueLng" DOUBLE PRECISION,
    "isVirtual" BOOLEAN NOT NULL DEFAULT false,
    "virtualUrl" TEXT,
    "capacity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "organizerId" TEXT NOT NULL,
    "categoryId" TEXT,
    "venueId" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "ageRestriction" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "rejectionReason" TEXT,
    "moderatedBy" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "isBookable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Event_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User" ("id") ON DELETE RESTRICT,
    CONSTRAINT "Event_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL,
    CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue" ("id") ON DELETE SET NULL
);

-- CreateTable
CREATE TABLE "EventTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventTag_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE,
    CONSTRAINT "EventTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "EventSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "venueId" TEXT,
    "venueName" TEXT,
    "participantId" TEXT,
    "sessionType" TEXT NOT NULL DEFAULT 'SESSION',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE,
    CONSTRAINT "EventSession_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue" ("id") ON DELETE SET NULL,
    CONSTRAINT "EventSession_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "EventParticipant" ("id") ON DELETE SET NULL
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'SPEAKER',
    "title" TEXT,
    "organization" TEXT,
    "socialLinks" TEXT,
    "email" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "EventMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GALLERY',
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventMedia_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE,
    CONSTRAINT "EventMedia_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User" ("id") ON DELETE RESTRICT
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'GH',
    "postalCode" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "googleMapsUrl" TEXT,
    "coverImage" TEXT,
    "capacity" INTEGER,
    "amenities" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "website" TEXT,
    "organizerId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Venue_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User" ("id") ON DELETE SET NULL
);

-- CreateTable
CREATE TABLE "TicketType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "quantity" INTEGER NOT NULL,
    "soldCount" INTEGER NOT NULL DEFAULT 0,
    "minPerOrder" INTEGER NOT NULL DEFAULT 1,
    "maxPerOrder" INTEGER NOT NULL DEFAULT 10,
    "saleStart" TIMESTAMP(3),
    "saleEnd" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketTypeId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ticket_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType" ("id") ON DELETE RESTRICT,
    CONSTRAINT "Ticket_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE RESTRICT
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bookingRef" TEXT NOT NULL,
    "cancellationReason" TEXT,
    "cancelledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT,
    CONSTRAINT "Booking_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "method" TEXT NOT NULL DEFAULT 'STRIPE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transactionId" TEXT,
    "providerRef" TEXT,
    "providerCustomerId" TEXT,
    "webhookEventId" TEXT,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "refundedAmount" INTEGER NOT NULL DEFAULT 0,
    "refundRef" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE RESTRICT,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "Review_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "Advertisement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "linkUrl" TEXT,
    "position" TEXT NOT NULL DEFAULT 'SIDEBAR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "eventId" TEXT,
    "advertiserId" TEXT,
    "organizerId" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Advertisement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL,
    CONSTRAINT "Advertisement_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "OrganizerProfile" ("id") ON DELETE SET NULL
);

-- CreateTable
CREATE TABLE "EventAnalytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "bookings" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventAnalytics_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "OrganizerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logo" TEXT,
    "coverImage" TEXT,
    "website" TEXT,
    "contactEmail" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "socialLinks" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "statusReason" TEXT,
    "statusChangedBy" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizerMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "invitedByEmail" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizerMembership_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "OrganizerProfile" ("id") ON DELETE CASCADE,
    CONSTRAINT "OrganizerMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizerInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizerInvitation_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "OrganizerProfile" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "StaffAssignment_userId_idx" ON "StaffAssignment"("userId");

-- CreateIndex
CREATE INDEX "StaffAssignment_eventId_idx" ON "StaffAssignment"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_userId_eventId_key" ON "StaffAssignment"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_slug_key" ON "SubscriptionPlan"("slug");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerSubscription_organizerId_key" ON "OrganizerSubscription"("organizerId");

-- CreateIndex
CREATE INDEX "OrganizerSubscription_planId_idx" ON "OrganizerSubscription"("planId");

-- CreateIndex
CREATE INDEX "OrganizerSubscription_status_idx" ON "OrganizerSubscription"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_organizerId_idx" ON "Event"("organizerId");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- CreateIndex
CREATE INDEX "Event_categoryId_idx" ON "Event"("categoryId");

-- CreateIndex
CREATE INDEX "Event_startDate_idx" ON "Event"("startDate");

-- CreateIndex
CREATE INDEX "Event_venueId_idx" ON "Event"("venueId");

-- CreateIndex
CREATE INDEX "Event_status_startDate_idx" ON "Event"("status", "startDate");

-- CreateIndex
CREATE INDEX "Event_organizerId_status_idx" ON "Event"("organizerId", "status");

-- CreateIndex
CREATE INDEX "EventTag_eventId_idx" ON "EventTag"("eventId");

-- CreateIndex
CREATE INDEX "EventTag_tagId_idx" ON "EventTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTag_eventId_tagId_key" ON "EventTag"("eventId", "tagId");

-- CreateIndex
CREATE INDEX "EventSession_eventId_idx" ON "EventSession"("eventId");

-- CreateIndex
CREATE INDEX "EventSession_eventId_date_idx" ON "EventSession"("eventId", "date");

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_idx" ON "EventParticipant"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_eventId_name_key" ON "EventParticipant"("eventId", "name");

-- CreateIndex
CREATE INDEX "EventMedia_eventId_idx" ON "EventMedia"("eventId");

-- CreateIndex
CREATE INDEX "EventMedia_eventId_category_idx" ON "EventMedia"("eventId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_slug_key" ON "Venue"("slug");

-- CreateIndex
CREATE INDEX "Venue_city_idx" ON "Venue"("city");

-- CreateIndex
CREATE INDEX "Venue_country_idx" ON "Venue"("country");

-- CreateIndex
CREATE INDEX "Venue_organizerId_idx" ON "Venue"("organizerId");

-- CreateIndex
CREATE INDEX "Venue_slug_idx" ON "Venue"("slug");

-- CreateIndex
CREATE INDEX "TicketType_eventId_idx" ON "TicketType"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_qrCode_key" ON "Ticket"("qrCode");

-- CreateIndex
CREATE INDEX "Ticket_bookingId_idx" ON "Ticket"("bookingId");

-- CreateIndex
CREATE INDEX "Ticket_ticketTypeId_idx" ON "Ticket"("ticketTypeId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_bookingRef_key" ON "Booking"("bookingRef");

-- CreateIndex
CREATE INDEX "Booking_userId_idx" ON "Booking"("userId");

-- CreateIndex
CREATE INDEX "Booking_eventId_idx" ON "Booking"("eventId");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Booking_eventId_status_idx" ON "Booking"("eventId", "status");

-- CreateIndex
CREATE INDEX "Booking_userId_status_idx" ON "Booking"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Review_eventId_idx" ON "Review"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_eventId_key" ON "Review"("userId", "eventId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Advertisement_organizerId_idx" ON "Advertisement"("organizerId");

-- CreateIndex
CREATE INDEX "EventAnalytics_eventId_date_idx" ON "EventAnalytics"("eventId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EventAnalytics_eventId_date_key" ON "EventAnalytics"("eventId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerProfile_userId_key" ON "OrganizerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerProfile_slug_key" ON "OrganizerProfile"("slug");

-- CreateIndex
CREATE INDEX "OrganizerProfile_slug_idx" ON "OrganizerProfile"("slug");

-- CreateIndex
CREATE INDEX "OrganizerProfile_approvalStatus_idx" ON "OrganizerProfile"("approvalStatus");

-- CreateIndex
CREATE INDEX "OrganizerProfile_status_idx" ON "OrganizerProfile"("status");

-- CreateIndex
CREATE INDEX "OrganizerMembership_organizerId_idx" ON "OrganizerMembership"("organizerId");

-- CreateIndex
CREATE INDEX "OrganizerMembership_userId_idx" ON "OrganizerMembership"("userId");

-- CreateIndex
CREATE INDEX "OrganizerMembership_organizerId_status_idx" ON "OrganizerMembership"("organizerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerMembership_organizerId_userId_key" ON "OrganizerMembership"("organizerId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerInvitation_tokenHash_key" ON "OrganizerInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_organizerId_idx" ON "OrganizerInvitation"("organizerId");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_tokenHash_idx" ON "OrganizerInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerInvitation_organizerId_email_key" ON "OrganizerInvitation"("organizerId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_tokenHash_idx" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_tokenHash_idx" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

