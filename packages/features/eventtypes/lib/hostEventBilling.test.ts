import process from "node:process";
import type { PrismaClient } from "@calcom/prisma";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostEventType, HostEventPaymentRequiredError } from "./hostEventBilling";

const originalFlag = process.env.HOST_EVENT_BILLING_ENABLED;
afterEach(() => {
  process.env.HOST_EVENT_BILLING_ENABLED = originalFlag;
});

describe("host event type billing", () => {
  const makePrisma = (existingEvents: number, freeClaims: number, paidClaims: number) => {
    const transaction = {
      eventType: { count: vi.fn().mockResolvedValue(existingEvents) },
      hostEventBilling: {
        upsert: vi.fn().mockResolvedValue({}),
        updateMany: vi
          .fn()
          .mockResolvedValueOnce({ count: freeClaims })
          .mockResolvedValueOnce({ count: paidClaims }),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction)
      ),
    } as unknown as PrismaClient;
    return { prisma, transaction };
  };

  it("uses the free lifetime creation for a new host", async () => {
    process.env.HOST_EVENT_BILLING_ENABLED = "true";
    const { prisma, transaction } = makePrisma(0, 1, 0);
    const create = vi.fn().mockResolvedValue("event");
    await expect(createHostEventType(prisma, 7, create)).resolves.toBe("event");
    expect(create).toHaveBeenCalledWith(transaction);
    expect(transaction.hostEventBilling.updateMany).toHaveBeenCalledTimes(1);
  });

  it("requires a paid credit after the first creation", async () => {
    process.env.HOST_EVENT_BILLING_ENABLED = "true";
    const { prisma } = makePrisma(1, 0, 0);
    const create = vi.fn();
    await expect(createHostEventType(prisma, 7, create)).rejects.toBeInstanceOf(
      HostEventPaymentRequiredError
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("consumes one credit when a paid event is created", async () => {
    process.env.HOST_EVENT_BILLING_ENABLED = "true";
    const { prisma, transaction } = makePrisma(1, 0, 1);
    const create = vi.fn().mockResolvedValue("event");
    await expect(createHostEventType(prisma, 7, create)).resolves.toBe("event");
    expect(transaction.hostEventBilling.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, credits: { gt: 0 } },
      data: { credits: { decrement: 1 } },
    });
  });
});
