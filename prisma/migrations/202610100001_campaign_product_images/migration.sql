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