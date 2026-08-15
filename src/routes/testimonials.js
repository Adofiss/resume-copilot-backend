import { Router } from "express";
import { z } from "zod";
import { submitTestimonial } from "../services/db.js";

export const testimonialsRouter = Router();

const bodySchema = z.object({
  quote: z.string().min(10, "Tell us a bit more — at least 10 characters.").max(2000),
  rating: z.number().int().min(1).max(5).optional(),
  displayName: z.string().max(100).optional(),
  consentToPublish: z.boolean()
});

/**
 * Stores a testimonial submission with status='pending'. Nothing here
 * auto-publishes anywhere — a human reviews these in Supabase's table
 * editor and manually adds approved ones to the marketing site. See the
 * design rationale in supabase-schema.sql above the testimonials table.
 */
testimonialsRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.issues[0].message });
  }

  try {
    await submitTestimonial(req.userId, parsed.data);
    res.json({ message: "Thank you! We read every submission." });
  } catch (err) {
    console.error("testimonial submission error:", err);
    res.status(500).json({ code: "DB_ERROR", message: "Could not submit feedback right now." });
  }
});
