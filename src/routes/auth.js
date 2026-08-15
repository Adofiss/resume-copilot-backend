import { Router } from "express";
import { z } from "zod";
import { supabase } from "../services/db.js";
import { authRateLimit } from "../middleware/rateLimits.js";
import { verifyTurnstile } from "../services/turnstile.js";

export const authRouter = Router();

// Applied to every route in this router: login, signup, forgot-password,
// and refresh are all pre-auth or credential-related, so all of them get
// the strict brute-force protection, not just login.
authRouter.use(authRateLimit);

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  turnstileToken: z.string().min(1, "Verification required.")
});

authRouter.post("/signup", async (req, res) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.issues[0].message });
  }

  const isHuman = await verifyTurnstile(parsed.data.turnstileToken, req.ip);
  if (!isHuman) {
    return res.status(400).json({ code: "VERIFICATION_FAILED", message: "Verification failed. Please try again." });
  }

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: process.env.EMAIL_CONFIRM_REDIRECT_URL || "https://resume-copilot.com/email-confirmed"
    }
  });
  if (error) return res.status(400).json({ code: "SIGNUP_FAILED", message: error.message });

  // With email confirmation enabled (Supabase default), session may be null until confirmed.
  if (!data.session) {
    return res.status(200).json({
      code: "CONFIRMATION_REQUIRED",
      message: "Check your email to confirm your account, then log in."
    });
  }

  res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: { email: data.user.email, id: data.user.id }
  });
});

authRouter.post("/login", async (req, res) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.issues[0].message });
  }

  const isHuman = await verifyTurnstile(parsed.data.turnstileToken, req.ip);
  if (!isHuman) {
    return res.status(400).json({ code: "VERIFICATION_FAILED", message: "Verification failed. Please try again." });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });
  if (error) return res.status(401).json({ code: "LOGIN_FAILED", message: error.message });

  res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: { email: data.user.email, id: data.user.id }
  });
});

/**
 * Triggers Supabase's built-in password reset email. The email contains a
 * link back to a hosted page (redirectTo below) where the person actually
 * sets their new password — that page runs entirely client-side using
 * Supabase's public anon key, since a password reset session is meant to be
 * established directly in the browser, not proxied through this backend.
 */
authRouter.post("/forgot-password", async (req, res) => {
  const email = req.body?.email;
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: "Enter a valid email address." });
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: process.env.RESET_PASSWORD_URL || "https://resume-copilot.com/reset-password"
  });

  // Deliberately don't reveal whether the email exists — always respond
  // success-shaped, so this endpoint can't be used to check which emails
  // have accounts. Only a genuine send failure surfaces as an error.
  if (error) {
    console.error("forgot-password error:", error.message);
  }

  res.json({ message: "If that email has an account, a reset link is on its way." });
});

/**
 * Exchanges a refresh token for a new access token + refresh token, without
 * requiring the user to log in again. Access tokens expire after 1 hour by
 * design (Supabase default) — this route is what lets the extension quietly
 * renew a session in the background instead of forcing a re-login every hour.
 */
authRouter.post("/refresh", async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken || typeof refreshToken !== "string") {
    return res.status(400).json({ code: "INVALID_INPUT", message: "Missing refresh token." });
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    // Refresh tokens can themselves expire/get revoked (e.g. after a password
    // change) — at that point there's no way to recover except a real login.
    return res.status(401).json({ code: "REFRESH_FAILED", message: "Session expired. Please log in again." });
  }

  res.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: { email: data.user.email, id: data.user.id }
  });
});
