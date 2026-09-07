-- CreateTable
CREATE TABLE "public"."RythmsCompany" (
    "id" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(600) NOT NULL DEFAULT '',
    "contactEmail" VARCHAR(254),
    "brandColor" VARCHAR(7) NOT NULL DEFAULT '#2563eb',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RythmsCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RythmsBookingLink" (
    "id" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "companyId" TEXT,
    "eventTypeId" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RythmsBookingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RythmsCompanyMember" (
    "companyId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RythmsCompanyMember_pkey" PRIMARY KEY ("companyId","userId")
);

-- CreateTable
CREATE TABLE "public"."RythmsCompanyInvitation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RythmsCompanyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RythmsCompanyMeeting" (
    "companyId" TEXT NOT NULL,
    "eventTypeId" INTEGER NOT NULL,

    CONSTRAINT "RythmsCompanyMeeting_pkey" PRIMARY KEY ("companyId","eventTypeId")
);

-- CreateIndex
CREATE INDEX "RythmsCompany_ownerId_idx" ON "public"."RythmsCompany"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "RythmsBookingLink_slug_key" ON "public"."RythmsBookingLink"("slug");

-- CreateIndex
CREATE INDEX "RythmsBookingLink_ownerId_idx" ON "public"."RythmsBookingLink"("ownerId");

-- CreateIndex
CREATE INDEX "RythmsBookingLink_companyId_idx" ON "public"."RythmsBookingLink"("companyId");

-- CreateIndex
CREATE INDEX "RythmsBookingLink_eventTypeId_idx" ON "public"."RythmsBookingLink"("eventTypeId");

-- CreateIndex
CREATE INDEX "RythmsCompanyMember_userId_idx" ON "public"."RythmsCompanyMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RythmsCompanyInvitation_tokenHash_key" ON "public"."RythmsCompanyInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RythmsCompanyInvitation_companyId_email_key" ON "public"."RythmsCompanyInvitation"("companyId", "email");

-- CreateIndex
CREATE INDEX "RythmsCompanyMeeting_eventTypeId_idx" ON "public"."RythmsCompanyMeeting"("eventTypeId");

-- AddForeignKey
ALTER TABLE "public"."RythmsCompany" ADD CONSTRAINT "RythmsCompany_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RythmsBookingLink" ADD CONSTRAINT "RythmsBookingLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RythmsBookingLink" ADD CONSTRAINT "RythmsBookingLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."RythmsCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RythmsBookingLink" ADD CONSTRAINT "RythmsBookingLink_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "public"."EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RythmsCompanyMember" ADD CONSTRAINT "RythmsCompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."RythmsCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RythmsCompanyMember" ADD CONSTRAINT "RythmsCompanyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RythmsCompanyInvitation" ADD CONSTRAINT "RythmsCompanyInvitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."RythmsCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RythmsCompanyMeeting" ADD CONSTRAINT "RythmsCompanyMeeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "public"."RythmsCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RythmsCompanyMeeting" ADD CONSTRAINT "RythmsCompanyMeeting_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "public"."EventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
