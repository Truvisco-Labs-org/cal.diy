import process from "node:process";
import { prisma } from "@calcom/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const secretKey = process.env.HOST_BILLING_STRIPE_SECRET_KEY;
  const webhookSecret = process.env.HOST_BILLING_STRIPE_WEBHOOK_SECRET;
  const signature = req.headers["stripe-signature"];
  if (!secretKey || !webhookSecret || !signature || Array.isArray(signature)) {
    return res.status(503).end();
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

  const stripe = new Stripe(secretKey, { apiVersion: "2020-08-27" });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(Buffer.concat(chunks), signature, webhookSecret);
  } catch {
    return res.status(400).end();
  }

  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const charge = event.data.object as Stripe.Charge | Stripe.Dispute;
    const paymentIntent = charge.payment_intent;
    if (!paymentIntent || typeof paymentIntent !== "string") return res.status(200).end();
    if (
      event.type === "charge.refunded" &&
      (charge as Stripe.Charge).amount_refunded < (charge as Stripe.Charge).amount
    )
      return res.status(200).end();
    await prisma.$transaction(async (transaction) => {
      await transaction.hostEventRefund.upsert({
        where: { stripePaymentIntentId: paymentIntent },
        create: { stripePaymentIntentId: paymentIntent },
        update: {},
      });
      const purchase = await transaction.hostEventPurchase.findUnique({
        where: { stripePaymentIntentId: paymentIntent },
        select: { userId: true, status: true },
      });
      if (!purchase || purchase.status === "refunded") return;
      const revoked = await transaction.hostEventPurchase.updateMany({
        where: { stripePaymentIntentId: paymentIntent, status: purchase.status },
        data: { status: "refunded" },
      });
      if (revoked.count === 0 || purchase.status !== "paid") return;
      await transaction.hostEventBilling.updateMany({
        where: { userId: purchase.userId, credits: { gt: 0 } },
        data: { credits: { decrement: 1 } },
      });
    });
    return res.status(200).end();
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return res.status(200).end();
  }
  const checkout = event.data.object as Stripe.Checkout.Session;
  if (checkout.payment_status !== "paid" || checkout.metadata?.purpose !== "host_event_type_credit") {
    return res.status(200).end();
  }

  try {
    await prisma.$transaction(async (transaction) => {
      const purchase = await transaction.hostEventPurchase.findUnique({
        where: { stripeCheckoutSessionId: checkout.id },
        select: { userId: true, status: true },
      });
      if (!purchase) throw new Error("Checkout purchase is not recorded yet");
      if (purchase.status === "paid" || purchase.status === "refunded") return;

      const paymentIntent = typeof checkout.payment_intent === "string" ? checkout.payment_intent : null;
      const refunded = paymentIntent
        ? await transaction.hostEventRefund.findUnique({
            where: { stripePaymentIntentId: paymentIntent },
            select: { stripePaymentIntentId: true },
          })
        : null;
      if (refunded) {
        await transaction.hostEventPurchase.updateMany({
          where: { stripeCheckoutSessionId: checkout.id, status: "pending" },
          data: { status: "refunded", stripePaymentIntentId: paymentIntent },
        });
        return;
      }

      const applied = await transaction.hostEventPurchase.updateMany({
        where: { stripeCheckoutSessionId: checkout.id, status: "pending" },
        data: {
          status: "paid",
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntent,
        },
      });
      if (applied.count === 0) return;
      await transaction.hostEventBilling.upsert({
        where: { userId: purchase.userId },
        create: { userId: purchase.userId, credits: 1 },
        update: { credits: { increment: 1 } },
      });
    });
  } catch {
    return res.status(503).end();
  }
  return res.status(200).end();
}
