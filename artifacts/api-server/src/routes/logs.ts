import { Router, type IRouter } from "express";
import { logBuffer } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/logs", (req, res) => {
  const limitParam = req.query["limit"];
  const level = typeof req.query["level"] === "string" ? req.query["level"].toLowerCase() : "all";
  const search = typeof req.query["search"] === "string" ? req.query["search"].toLowerCase() : "";
  const limit = limitParam ? Math.min(parseInt(String(limitParam), 10) || 200, 500) : 200;

  let entries = logBuffer.recent(limit);

  if (level !== "all") {
    entries = entries.filter((e) => e.level === level);
  }

  if (search) {
    entries = entries.filter((e) =>
      e.msg.toLowerCase().includes(search) ||
      JSON.stringify(e).toLowerCase().includes(search)
    );
  }

  res.json({ entries });
});

export default router;
