ALTER TABLE "Campaign"
ADD COLUMN "mainImageData" TEXT,
ADD COLUMN "supportingImageData" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "brandName" TEXT,
ADD COLUMN "category" TEXT,
ADD COLUMN "packSize" TEXT,
ADD COLUMN "mrpPaisa" BIGINT,
ADD COLUMN "description" TEXT,
ADD COLUMN "sellingPoints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "whatsappPitch" TEXT,
ADD COLUMN "customerOffer" TEXT,
ADD COLUMN "faq" JSONB,
ADD COLUMN "serviceArea" TEXT,
ADD COLUMN "availableQuantity" INTEGER,
ADD COLUMN "deliveryInfo" TEXT,
ADD COLUMN "campaignTerms" TEXT;

ALTER TABLE "Campaign"
ADD CONSTRAINT "Campaign_availableQuantity_nonnegative"
CHECK ("availableQuantity" IS NULL OR "availableQuantity" >= 0);

ALTER TABLE "Campaign"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Order"
ADD COLUMN "deliveryLocation" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "campaignVersionSnapshot" INTEGER,
ADD COLUMN "customerOfferSnapshot" TEXT,
ADD COLUMN "campaignTermsSnapshot" TEXT,
ADD COLUMN "deliveryInfoSnapshot" TEXT;

CREATE TABLE "CampaignRevision" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CampaignRevision_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CampaignRevision_campaignId_version_key" ON "CampaignRevision"("campaignId","version");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "orderId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId","readAt","createdAt");
CREATE INDEX "Order_campaignId_expiresAt_idx" ON "Order"("campaignId","expiresAt");