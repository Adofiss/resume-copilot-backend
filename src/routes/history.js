import { Router } from "express";
import { getHistory } from "../services/db.js";

export const historyRouter = Router();

historyRouter.get("/", async (req, res) => {
  try {
    const history = await getHistory(req.userId);
    res.json({ history });
  } catch (err) {
    console.error("history error:", err);
    res.status(500).json({ code: "DB_ERROR", message: "Could not load history." });
  }
});
