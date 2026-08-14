import { Router } from "express";
import { z } from "zod";
import { generateCoverLetter } from "../services/llm.js";
import { logUsage, logHistory } from "../services/db.js";

export const coverLetterRouter = Router();

const bodySchema = z.object({
  resumeText: z.string().min(50),
  jobDescription: z.string().min(50),
  company: z.string().nullable().optional(),
  title: z.string().nullable().optional()
});

coverLetterRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.issues[0].message });
  }

  try {
    const { parsed: result, usage } = await generateCoverLetter(parsed.data);
    // Respond immediately — logging runs in the background.
    logUsage(req.userId, "cover_letter", usage?.output_tokens).catch((err) =>
      console.error("logUsage failed (non-blocking):", err)
    );
    logHistory(req.userId, {
      job_title: parsed.data.title,
      company: parsed.data.company,
      action: "cover_letter"
    }).catch((err) => console.error("logHistory failed (non-blocking):", err));
    res.json(result);
  } catch (err) {
    console.error("cover letter error:", err);
    res.status(502).json({ code: "LLM_ERROR", message: "Could not generate a cover letter right now." });
  }
});
