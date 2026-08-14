import { Router } from "express";
import { z } from "zod";
import { supabase } from "../services/db.js";

export const authRouter = Router();

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

authRouter.post("/signup", async (req, res) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.issues[0].message });
  }

  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) return res.status(400).json({ code: "SIGNUP_FAILED", message: error.message });

  // With email confirmation enabled (Supabase default), session may be null until confirmed.
  if (!data.session) {
    return res.status(200).json({
      code: "CONFIRMATION_REQUIRED",
      message: "Check your email to confirm your account, then log in."
    });
  }

  res.json({ token: data.session.access_token, user: { email: data.user.email, id: data.user.id } });
});

authRouter.post("/login", async (req, res) => {
  const parsed = credsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.issues[0].message });
  }

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return res.status(401).json({ code: "LOGIN_FAILED", message: error.message });

  res.json({ token: data.session.access_token, user: { email: data.user.email, id: data.user.id } });
});
