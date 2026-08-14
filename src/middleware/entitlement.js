import { supabase, spendCredit } from "../services/db.js";

/**
 * Gates the PAID actions only (tailor bullets, cover letter). Match scoring
 * is free and unlimited, so it does NOT use this middleware at all — see
 * server.js, where /api/score is mounted with requireAuth but not this.
 *
 * Access rule: active Stripe subscription -> unlimited, no credit spent.
 * Otherwise -> must have at least 1 purchased credit, which gets spent
 * atomically on this request (see spend_credit SQL function in db.js).
 */
export async function requireEntitlement(req, res, next) {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", req.userId)
    .eq("status", "active")
    .maybeSingle();

  if (sub) return next(); // paying subscriber, unlimited paid actions

  const spent = await spendCredit(req.userId);
  if (!spent) {
    return res.status(402).json({
      code: "PAYMENT_REQUIRED",
      message: "This action costs 1 credit, or subscribe for unlimited use. You're out of credits."
    });
  }

  next();
}
