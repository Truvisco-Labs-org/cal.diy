import { Readable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { status: "pending", credits: 0, refundRecorded: false };
vi.mock("@calcom/prisma", () => ({
  prisma: {
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        hostEventPurchase: {
          findUnique: async ({ where }: { where: { stripePaymentIntentId?: string } }) =>
            where.stripePaymentIntentId && state.status === "pending"
              ? null
              : { userId: 7, status: state.status },
          updateMany: async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
            if (state.status !== where.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
        },
        hostEventRefund: {
          upsert: async () => {
            state.refundRecorded = true;
          },
          findUnique: async () =>
            state.refundRecorded ? { stripePaymentIntentId: "pi_test_host_billing" } : null,
        },
        hostEventBilling: {
          upsert: async () => {
            state.credits += 1;
          },
          updateMany: async () => {
            if (state.credits === 0) return { count: 0 };
            state.credits -= 1;
            return { count: 1 };
          },
        },
      }),
  },
}));

import handler from "./webhook";

const webhookSecret = "whsec_test_host_billing";
const stripe = new Stripe("sk_test_placeholder", { apiVersion: "2020-08-27" });
const payload = JSON.stringify({
  id: "evt_test_host_billing",
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_host_billing",
      object: "checkout.session",
      payment_status: "paid",
      metadata: { purpose: "host_event_type_credit" },
      payment_intent: "pi_test_host_billing",
    },
  },
});

async function deliver(signature: string, body = payload) {
  const request = Object.assign(Readable.from([Buffer.from(body)]), {
    method: "POST",
    headers: { "stripe-signature": signature },
  }) as unknown as NextApiRequest;
  let statusCode = 200;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    end() {
      return this;
    },
  } as unknown as NextApiResponse;
  await handler(request, response);
  return statusCode;
}

describe("host billing webhook", () => {
  beforeEach(() => {
    state.status = "pending";
    state.credits = 0;
    state.refundRecorded = false;
    process.env.HOST_BILLING_STRIPE_SECRET_KEY = "sk_test_placeholder";
    process.env.HOST_BILLING_STRIPE_WEBHOOK_SECRET = webhookSecret;
  });

  it("grants exactly one credit when Stripe retries a paid checkout", async () => {
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    expect(await deliver(signature)).toBe(200);
    expect(await deliver(signature)).toBe(200);
    expect(state.credits).toBe(1);
  });

  it("revokes an unused credit after a full refund", async () => {
    state.status = "paid";
    state.credits = 1;
    const refund = JSON.stringify({
      id: "evt_test_refund",
      object: "event",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_refund",
          object: "charge",
          payment_intent: "pi_test_host_billing",
          amount: 100,
          amount_refunded: 100,
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload: refund, secret: webhookSecret });
    expect(await deliver(signature, refund)).toBe(200);
    expect(state.credits).toBe(0);
    expect(state.status).toBe("refunded");
  });

  it("does not grant a credit when a refund arrives before checkout completion", async () => {
    const refund = JSON.stringify({
      id: "evt_test_early_refund",
      object: "event",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_early_refund",
          object: "charge",
          payment_intent: "pi_test_host_billing",
          amount: 100,
          amount_refunded: 100,
        },
      },
    });
    const refundSignature = stripe.webhooks.generateTestHeaderString({
      payload: refund,
      secret: webhookSecret,
    });
    const checkoutSignature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    expect(await deliver(refundSignature, refund)).toBe(200);
    expect(await deliver(checkoutSignature)).toBe(200);
    expect(state.credits).toBe(0);
    expect(state.status).toBe("refunded");
  });

  it("rejects an invalid signature without granting credit", async () => {
    expect(await deliver("invalid")).toBe(400);
    expect(state.credits).toBe(0);
  });
});
