import process from "node:process";
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

export class HostEventPaymentRequiredError extends Error {
  constructor() {
    super("HOST_EVENT_PAYMENT_REQUIRED");
  }
}

export async function createHostEventType<T>(
  prisma: PrismaClient,
  userId: number,
  create: (transaction: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (process.env.HOST_EVENT_BILLING_ENABLED !== "true") {
    return create(prisma);
  }

  return prisma.$transaction(async (transaction) => {
    const existingEventTypes = await transaction.eventType.count({ where: { userId } });
    await transaction.hostEventBilling.upsert({
      where: { userId },
      create: { userId, freeCreationUsed: existingEventTypes > 0 },
      update: {},
    });

    const freeCreation = await transaction.hostEventBilling.updateMany({
      where: { userId, freeCreationUsed: false },
      data: { freeCreationUsed: true },
    });
    if (freeCreation.count === 0) {
      const paidCreation = await transaction.hostEventBilling.updateMany({
        where: { userId, credits: { gt: 0 } },
        data: { credits: { decrement: 1 } },
      });
      if (paidCreation.count === 0) {
        throw new HostEventPaymentRequiredError();
      }
    }

    return create(transaction);
  });
}
