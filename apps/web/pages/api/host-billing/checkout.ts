import process from "node:process";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { prisma } from "@calcom/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  if (process.env.HOST_EVENT_BILLING_ENABLED !== "true") return res.status(503).end();

  const webappUrl = process.env.NEXT_PUBLIC_WEBAPP_URL;
  const secretKey = process.env.HOST_BILLING_STRIPE_SECRET_KEY;
  if (!webappUrl || !secretKey) return res.status(503).end();
  if (req.headers.origin !== new URL(webappUrl).origin) return res.status(403).end();

  const session = await getServerSession({ req });
  if (!session?.user?.id) return res.status(401).end();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true },
  });
  if (!user) return res.status(401).end();

  const stripe = new Stripe(secretKey, { apiVersion: "2020-08-27" });
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    client_reference_id: String(user.id),
    metadata: { purpose: "host_event_type_credit" },
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: 100,
          product_data: { name: "Additional Cal.DIY event type" },
        },
        quantity: 1,
      },
    ],
    success_url: `${webappUrl}/event-types?hostBilling=success`,
    cancel_url: `${webappUrl}/event-types?hostBilling=cancelled`,
  });
  if (!checkout.url) return res.status(502).end();

  await prisma.hostEventPurchase.create({
    data: { userId: user.id, stripeCheckoutSessionId: checkout.id },
  });
  return res.status(200).json({ url: checkout.url });
}
