import { Router } from "express";
import { getHistory } from "../services/db.js";

export const historyRouter = Router();

historyRouter.get("/", async (req, res) => {
  try {
    const history = await getHistory(req.userId);
    // Return only what the client displays — drop internal fields like the
    // row id and user_id that add nothing for the caller and needlessly
    // echo back data that doesn't need to leave the server.
    const trimmed = history.map((row) => ({
      jobTitle: row.job_title,
      company: row.company,
      url: row.job_url,
      matchPercent: row.match_percent,
      action: row.action,
      createdAt: row.created_at
    }));
    res.json({ history: trimmed });
  } catch (err) {
    console.error("history error:", err);
    res.status(500).json({ code: "DB_ERROR", message: "Could not load history." });
  }
});
