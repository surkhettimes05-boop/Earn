ALTER TABLE "Campaign"
ADD COLUMN "mainImageData" TEXT,
ADD COLUMN "supportingImageData" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];