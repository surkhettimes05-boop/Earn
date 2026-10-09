-- EARN commission engine foundation.
-- Backward compatible: existing campaigns keep their current fixed reward behavior.
-- New ORDER campaigns can define what the business pays, while EARN snapshots
-- the earner/platform split on each order.

DO $$ BEGIN
  CREATE TYPE "CommissionBasis" AS ENUM ('FIXED_ORDER','PER_UNIT','PERCENT_GMV');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "commissionBasis" "CommissionBasis" NOT NULL DEFAULT 'FIXED_ORDER',
  ADD COLUMN IF NOT EXISTS "unitLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "unitPricePaisa" BIGINT,
  ADD COLUMN IF NOT EXISTS "businessCommissionPaisa" BIGINT,
  ADD COLUMN IF NOT EXISTS "businessCommissionBps" INTEGER,
  ADD COLUMN IF NOT EXISTS "earnerShareBps" INTEGER NOT NULL DEFAULT 10000;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "unitPricePaisaSnapshot" BIGINT,
  ADD COLUMN IF NOT EXISTS "commissionBasisSnapshot" "CommissionBasis",
  ADD COLUMN IF NOT EXISTS "businessCommissionPaisaSnapshot" BIGINT,
  ADD COLUMN IF NOT EXISTS "businessCommissionBpsSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "earnerShareBpsSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "earnerRewardPaisaSnapshot" BIGINT,
  ADD COLUMN IF NOT EXISTS "platformFeePaisaSnapshot" BIGINT;

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_earnerShareBps_check"
  CHECK ("earnerShareBps" >= 0 AND "earnerShareBps" <= 10000);

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_businessCommissionBps_check"
  CHECK ("businessCommissionBps" IS NULL OR ("businessCommissionBps" > 0 AND "businessCommissionBps" <= 10000));

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_earnerShareBpsSnapshot_check"
  CHECK ("earnerShareBpsSnapshot" IS NULL OR ("earnerShareBpsSnapshot" >= 0 AND "earnerShareBpsSnapshot" <= 10000));
