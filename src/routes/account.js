import { Router } from "express";
import Stripe from "stripe";
import { getStripeCustomerId, deleteUserAccount } from "../services/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const accountRouter = Router();

/**
 * Permanently deletes the authenticated user's account and all associated
 * data. Order matters here: we cancel any active Stripe subscription FIRST
 * (while we still have the customer/subscription IDs on hand), then wipe
 * the database rows and the auth user itself. This is irreversible.
 */
accountRouter.delete("/", async (req, res) => {
  try {
    const customerId = await getStripeCustomerId(req.userId);
    if (customerId) {
      // List and cancel any active subscriptions for this customer, so a
      // deleted account can't keep silently billing someone.
      const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "active" });
      for (const sub of subscriptions.data) {
        await stripe.subscriptions.cancel(sub.id);
      }
    }

    await deleteUserAccount(req.userId);
    res.json({ message: "Account deleted." });
  } catch (err) {
    console.error("account deletion error:", err);
    res.status(500).json({
      code: "DELETE_FAILED",
      message: "Could not fully delete your account. Please contact support@resume-copilot.com."
    });
  }
});
