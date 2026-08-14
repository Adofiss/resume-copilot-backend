import { Router } from "express";
import { z } from "zod";
import { scoreResume } from "../services/llm.js";
import { logUsage } from "../services/db.js";

export const scoreRouter = Router();

const bodySchema = z.object({
  resumeText: z.string().min(50, "Resume text looks too short."),
  jobDescription: z.string().min(50, "Job description looks too short.")
});

scoreRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.issues[0].message });
  }

  try {
    const { parsed: result, usage } = await scoreResume(parsed.data);
    // Respond immediately — log usage in the background, don't make the
    // user wait on a Supabase write that has no bearing on their result.
    logUsage(req.userId, "score", usage?.output_tokens).catch((err) =>
      console.error("logUsage failed (non-blocking):", err)
    );
    res.json(result);
  } catch (err) {
    console.error("score error:", err);
    res.status(502).json({ code: "LLM_ERROR", message: "Could not score resume right now." });
  }
});
