import { Router } from "express";
import { z } from "zod";
import { tailorBullets } from "../services/llm.js";
import { logUsage, logHistory } from "../services/db.js";

export const tailorRouter = Router();

const bodySchema = z.object({
  resumeText: z.string().min(50),
  jobDescription: z.string().min(50),
  scoreResult: z.object({
    matchPercent: z.number(),
    gaps: z.array(z.object({ label: z.string(), covered: z.boolean() }))
  })
});

tailorRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ code: "INVALID_INPUT", message: parsed.error.issues[0].message });
  }

  try {
    const { parsed: result, usage } = await tailorBullets(parsed.data);
    // Respond immediately — logging runs in the background.
    logUsage(req.userId, "tailor", usage?.output_tokens).catch((err) =>
      console.error("logUsage failed (non-blocking):", err)
    );
    logHistory(req.userId, {
      match_percent: parsed.data.scoreResult.matchPercent,
      action: "tailor"
    }).catch((err) => console.error("logHistory failed (non-blocking):", err));
    res.json(result);
  } catch (err) {
    console.error("tailor error:", err);
    res.status(502).json({ code: "LLM_ERROR", message: "Could not generate tailored bullets right now." });
  }
});
