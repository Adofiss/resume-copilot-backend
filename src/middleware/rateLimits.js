import rateLimit from "express-rate-limit";

/**
 * Stricter limiter for routes that call a paid external API (Anthropic).
 * Keyed by authenticated user ID rather than IP address — these routes only
 * ever run after requireAuth, and per-user is the right unit here: IP-based
 * limiting is either too loose (many people behind one office/campus IP) or
 * too strict (one person switching wifi/cellular), whereas your actual cost
 * exposure is fundamentally per-account regardless of network.
 *
 * This matters most for /api/score specifically — it's free and unlimited
 * by design, so it's the one route nothing else (credits, subscription
 * checks) naturally throttles. Without this, a script could call it in a
 * tight loop indefinitely at real cost to you with zero revenue.
 */
export const llmRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // generous for a real job search, a hard wall for a runaway script
  keyGenerator: (req) => req.userId,
  handler: (req, res) => {
    res.status(429).json({
      code: "RATE_LIMITED",
      message: "Too many requests. Please slow down and try again in a few minutes."
    });
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Strict limiter for login/signup/password-reset — these run BEFORE
 * authentication, so there's no req.userId to key on yet. Keyed by IP
 * instead, which is exactly right here: brute-forcing a password or mass-
 * creating accounts is fundamentally about repeated attempts from a source,
 * and this is the one place in the app where IP is the correct unit rather
 * than user ID.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP per 15 min — enough for a real person who
           // mistypes a password a few times, a hard wall for brute force
  handler: (req, res) => {
    res.status(429).json({
      code: "RATE_LIMITED",
      message: "Too many attempts. Please wait a few minutes and try again."
    });
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Lighter limiter for Stripe checkout session creation. Not "paid per call"
 * the way Anthropic is (a Checkout Session only costs money if someone
 * actually completes payment), but still worth capping — Stripe has its own
 * API rate limits, and there's no legitimate reason for one account to spin
 * up checkout sessions rapidly.
 */
export const checkoutRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  keyGenerator: (req) => req.userId,
  handler: (req, res) => {
    res.status(429).json({
      code: "RATE_LIMITED",
      message: "Too many checkout attempts. Please try again in a few minutes."
    });
  },
  standardHeaders: true,
  legacyHeaders: false
});
