import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { supabase, addCredits, getCreditBalance, getStripeCustomerId } from "../services/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const billingRouter = Router();

/** Creates a Stripe Checkout session for the $8.99/mo unlimited subscription. */
billingRouter.post("/checkout", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID_MONTHLY, quantity: 1 }],
      client_reference_id: req.userId,
      customer_email: req.userEmail,
      success_url:
        process.env.CHECKOUT_SUCCESS_URL_SUBSCRIPTION || "https://resume-copilot.com/upgrade-success-subscription",
      cancel_url: process.env.CHECKOUT_CANCEL_URL || "https://resume-copilot.com/upgrade-cancel"
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err);
    res.status(502).json({ code: "STRIPE_ERROR", message: "Could not start checkout." });
  }
});

/**
 * Pay-per-use credit packs. 1 credit = 1 tailor OR 1 cover letter action.
 * Create these as one-time Prices in the Stripe dashboard (not recurring),
 * and set the resulting price IDs as env vars.
 *
 *   single -> $0.99, 1 credit   (STRIPE_PRICE_ID_CREDIT_SINGLE)
 *   ten    -> $7.99, 10 credits (STRIPE_PRICE_ID_CREDIT_TEN)   <- ~20% cheaper per credit
 */
const CREDIT_PACKS = {
  single: {
    priceId: process.env.STRIPE_PRICE_ID_CREDIT_SINGLE,
    credits: 1,
    successUrl:
      process.env.CHECKOUT_SUCCESS_URL_CREDIT_SINGLE || "https://resume-copilot.com/upgrade-success-credit-single"
  },
  ten: {
    priceId: process.env.STRIPE_PRICE_ID_CREDIT_TEN,
    credits: 10,
    successUrl: process.env.CHECKOUT_SUCCESS_URL_CREDIT_TEN || "https://resume-copilot.com/upgrade-success-credit-ten"
  }
};

/** Creates a one-time-payment Checkout session for a credit pack. */
billingRouter.post("/checkout/credits", async (req, res) => {
  const parsed = z.object({ pack: z.enum(["single", "ten"]) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: "pack must be 'single' or 'ten'." });
  }

  const pack = CREDIT_PACKS[parsed.data.pack];
  if (!pack.priceId) {
    return res.status(400).json({ code: "INVALID_INPUT", message: "Unknown or unconfigured credit pack." });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: pack.priceId, quantity: 1 }],
      client_reference_id: req.userId,
      customer_email: req.userEmail,
      // metadata survives to the webhook so we know how many credits to add
      metadata: { userId: req.userId, credits: String(pack.credits) },
      success_url: pack.successUrl,
      cancel_url: process.env.CHECKOUT_CANCEL_URL || "https://resume-copilot.com/upgrade-cancel"
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("credit checkout error:", err);
    res.status(502).json({ code: "STRIPE_ERROR", message: "Could not start checkout." });
  }
});

/**
 * Creates a Stripe Customer Portal session — a hosted page Stripe builds
 * and maintains where the user can view billing history, update their
 * payment method, and CANCEL their subscription. This is the actual
 * cancellation mechanism for the app; without it, subscribed users have
 * no way to cancel from within the product at all.
 *
 * Requires the Customer Portal to be activated once in the Stripe
 * dashboard (Settings -> Billing -> Customer portal) — separately for
 * test mode and live mode.
 */
billingRouter.post("/portal", async (req, res) => {
  try {
    const customerId = await getStripeCustomerId(req.userId);
    if (!customerId) {
      return res.status(400).json({
        code: "NO_SUBSCRIPTION",
        message: "No active subscription to manage yet."
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.PORTAL_RETURN_URL || "https://resume-copilot.com"
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("billing portal error:", err);
    res.status(502).json({ code: "STRIPE_ERROR", message: "Could not open billing management." });
  }
});

/** Returns the user's current credit balance, for the options page to display. */
billingRouter.get("/credits", async (req, res) => {
  try {
    const [balance, { data: sub }] = await Promise.all([
      getCreditBalance(req.userId),
      supabase.from("subscriptions").select("status").eq("user_id", req.userId).eq("status", "active").maybeSingle()
    ]);
    res.json({ balance, subscribed: Boolean(sub) });
  } catch (err) {
    console.error("credit balance error:", err);
    res.status(500).json({ code: "DB_ERROR", message: "Could not load credit balance." });
  }
});

/**
 * Stripe webhook — keeps the `subscriptions` table and `credits` balances in sync.
 * IMPORTANT: mount this route with express.raw() BEFORE express.json() in server.js,
 * since Stripe requires the raw body to verify the signature.
 */
billingRouter.post("/webhook", async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;

      if (session.mode === "subscription") {
        await supabase.from("subscriptions").upsert({
          user_id: session.client_reference_id,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          status: "active"
        });
      } else if (session.mode === "payment") {
        // One-time credit pack purchase.
        const userId = session.metadata?.userId;
        const credits = Number(session.metadata?.credits ?? 0);
        if (userId && credits > 0) {
          await addCredits(userId, credits);
        }
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await supabase
        .from("subscriptions")
        .update({ status: sub.status })
        .eq("stripe_subscription_id", sub.id);
      break;
    }
  }

  res.json({ received: true });
});
