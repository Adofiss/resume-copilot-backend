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
    // Stripe cleanup is best-effort and deliberately isolated from the rest
    // of this handler: a person's right to delete their account and data
    // shouldn't be blocked by a billing-system hiccup (e.g. a stale
    // customer ID from a test-mode/live-mode switch). If this fails, we log
    // it for manual follow-up but proceed with the actual deletion regardless.
    try {
      const customerId = await getStripeCustomerId(req.userId);
      if (customerId) {
        const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "active" });
        for (const sub of subscriptions.data) {
          await stripe.subscriptions.cancel(sub.id);
        }
      }
    } catch (stripeErr) {
      console.error(
        `Stripe cleanup failed during account deletion for user ${req.userId} — proceeding with deletion anyway. Manually verify/cancel their subscription in Stripe. Error:`,
        stripeErr.message
      );
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
