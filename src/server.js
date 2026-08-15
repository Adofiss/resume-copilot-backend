import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { authRouter } from "./routes/auth.js";
import { scoreRouter } from "./routes/score.js";
import { tailorRouter } from "./routes/tailor.js";
import { coverLetterRouter } from "./routes/coverLetter.js";
import { historyRouter } from "./routes/history.js";
import { billingRouter } from "./routes/billing.js";
import { requireAuth } from "./middleware/auth.js";
import { requireEntitlement } from "./middleware/entitlement.js";
import { llmRateLimit, checkoutRateLimit } from "./middleware/rateLimits.js";

const app = express();

// Railway (and most PaaS platforms) sit the app behind a reverse proxy, so
// every request arrives with an X-Forwarded-For header set by that proxy.
// Trusting exactly 1 hop tells Express "believe the immediate proxy in front
// of me" without blindly trusting arbitrary client-supplied headers further
// up the chain — this is what express-rate-limit needs to safely identify
// unique users instead of throwing on the header it doesn't expect.
app.set("trust proxy", 1);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));

// Sets a standard set of security-related HTTP headers (X-Content-Type-Options,
// X-Frame-Options, Strict-Transport-Security, etc). This is a pure JSON API
// with no HTML pages of its own, so helmet's default CSP (meant for pages
// that render markup) is disabled — it has nothing to protect here and would
// only add noise. HSTS stays on: it tells browsers to always use HTTPS for
// this domain going forward, reinforcing what Railway's edge already enforces.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(compression());

// Stripe webhook needs the raw body for signature verification, so it must
// be mounted BEFORE express.json() and must not go through the JSON parser.
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "1mb" }));

// Basic abuse protection on top of the per-user entitlement cap.
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
app.use("/api", limiter);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);

// The webhook sub-route inside billingRouter must stay public (Stripe calls
// it directly, no user token) — it's already mounted with express.raw()
// above, before this. Checkout and the credit balance lookup need a user.
app.use("/api/billing/checkout", requireAuth, checkoutRateLimit);
app.use("/api/billing/portal", requireAuth);
app.use("/api/billing/credits", requireAuth);
app.use("/api/billing", billingRouter);

// Everything below requires a logged-in user.
// Score is free and unlimited — auth only, no credit/subscription check,
// but it's the one route with no natural cost throttle, so llmRateLimit
// carries the full weight of protecting it from abuse.
app.use("/api/score", requireAuth, llmRateLimit, scoreRouter);
// Tailor and cover letter are paid actions (subscription or 1 credit each)
// AND rate limited — the credit/subscription check stops cost from being
// free, but doesn't stop a compromised or scripted subscriber account from
// firing rapid-fire requests, so both protections apply together.
app.use("/api/tailor", requireAuth, requireEntitlement, llmRateLimit, tailorRouter);
app.use("/api/cover-letter", requireAuth, requireEntitlement, llmRateLimit, coverLetterRouter);
app.use("/api/history", requireAuth, historyRouter);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Something went wrong." });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Resume Copilot backend listening on :${port}`));
