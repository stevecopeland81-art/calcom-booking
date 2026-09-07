CREATE TABLE "RythmsCalendarSync" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "calendars" JSONB NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "cleanup" BOOLEAN NOT NULL DEFAULT false,
  "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  CONSTRAINT "RythmsCalendarSync_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RythmsCalendarSync_userId_key" ON "RythmsCalendarSync"("userId");
CREATE INDEX "RythmsCalendarSync_nextRunAt_idx" ON "RythmsCalendarSync"("nextRunAt");
ALTER TABLE "RythmsCalendarSync" ADD CONSTRAINT "RythmsCalendarSync_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RythmsCalendarMirror" (
  "id" TEXT NOT NULL,
  "syncId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "credentialId" INTEGER NOT NULL,
  "calendarId" TEXT NOT NULL,
  "eventId" TEXT,
  "transactionId" TEXT NOT NULL,
  CONSTRAINT "RythmsCalendarMirror_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RythmsCalendarMirror_syncId_sourceKey_targetKey_key"
  ON "RythmsCalendarMirror"("syncId", "sourceKey", "targetKey");
ALTER TABLE "RythmsCalendarMirror" ADD CONSTRAINT "RythmsCalendarMirror_syncId_fkey"
  FOREIGN KEY ("syncId") REFERENCES "RythmsCalendarSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;
