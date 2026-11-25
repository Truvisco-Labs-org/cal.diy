CREATE TABLE "HostEventBilling" (
    "userId" INTEGER NOT NULL,
    "freeCreationUsed" BOOLEAN NOT NULL DEFAULT false,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "stripeCustomerId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HostEventBilling_pkey" PRIMARY KEY ("userId")
);
CREATE TABLE "HostEventPurchase" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    CONSTRAINT "HostEventPurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HostEventBilling_stripeCustomerId_key" ON "HostEventBilling"("stripeCustomerId");
CREATE UNIQUE INDEX "HostEventPurchase_stripeCheckoutSessionId_key" ON "HostEventPurchase"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "HostEventPurchase_stripePaymentIntentId_key" ON "HostEventPurchase"("stripePaymentIntentId");
CREATE INDEX "HostEventPurchase_userId_idx" ON "HostEventPurchase"("userId");
ALTER TABLE "HostEventBilling" ADD CONSTRAINT "HostEventBilling_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HostEventPurchase" ADD CONSTRAINT "HostEventPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HostEventRefund" (
    "stripePaymentIntentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HostEventRefund_pkey" PRIMARY KEY ("stripePaymentIntentId")
);
