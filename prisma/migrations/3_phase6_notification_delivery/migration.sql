-- Phase 6: Notification Delivery Infrastructure
--
-- Adds delivery tracking, dedup, preference, and polymorphic reference fields
-- to the Notification model, and creates the NotificationPreference table.
--
-- Safe migration: all new columns are nullable or have defaults.
-- Existing Notification rows will get default values.

-- 1. Add new columns to Notification table
ALTER TABLE "Notification" ADD COLUMN "eventId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "relatedEntityId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "relatedEntityType" TEXT;
ALTER TABLE "Notification" ADD COLUMN "deliveryChannel" TEXT NOT NULL DEFAULT 'IN_APP';
ALTER TABLE "Notification" ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Notification" ADD COLUMN "dedupKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "failedAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP(3);

-- 2. Add unique constraint on dedupKey (partial index — NULLs excluded)
-- SQLite and PostgreSQL both support partial unique indexes
CREATE UNIQUE INDEX "Notification_dedupKey_key" ON "Notification"("dedupKey") WHERE "dedupKey" IS NOT NULL;

-- 3. Add new indexes
CREATE INDEX "Notification_userId_deliveryStatus_idx" ON "Notification"("userId", "deliveryStatus");
CREATE INDEX "Notification_eventId_idx" ON "Notification"("eventId");
CREATE INDEX "Notification_relatedEntityId_relatedEntityType_idx" ON "Notification"("relatedEntityId", "relatedEntityType");

-- 4. Create NotificationPreference table
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- 5. NotificationPreference indexes and constraints
CREATE UNIQUE INDEX "NotificationPreference_userId_type_channel_key" ON "NotificationPreference"("userId", "type", "channel");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");
