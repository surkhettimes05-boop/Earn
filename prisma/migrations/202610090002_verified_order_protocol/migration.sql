ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CUSTOMER_CONFIRMED';

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "customerConfirmTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryPinHash" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Order_customerConfirmTokenHash_key"
ON "Order"("customerConfirmTokenHash");