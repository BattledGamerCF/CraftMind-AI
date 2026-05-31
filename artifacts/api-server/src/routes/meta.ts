import { Router, type IRouter } from "express";

import { logger } from "../lib/logger.js";

export const TESTED_VERSIONS = [
  "1.16.5",
  "1.18.2",
  "1.19.4",
  "1.20.1",
  "1.20.4",
] as const;

export const LATEST_TESTED = "1.20.4";

const router: IRouter = Router();

router.get("/meta", (_req, res) => {
  res.json({
    testedVersions: TESTED_VERSIONS,
    latestTested: LATEST_TESTED,
    providers: ["ollama", "openai", "anthropic"],
    cognitiveModes: [
      "deterministic",
      "lightweight",
      "balanced",
      "auto",
      "deep-reasoning",
    ],
    playstyles: ["companion", "worker", "adventurer", "safe", "auto"],
    note: "version field is optional. Leave blank to let mineflayer auto-detect.",
  });
});

/** Only allow the Ollama proxy to reach localhost/loopback addresses. */
function isAllowedOllamaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * GET /api/ollama/models?baseUrl=http://localhost:11434
 * Proxies the Ollama model list so the browser avoids CORS issues.
 * Only loopback addresses are permitted to prevent SSRF.
 */
router.get("/ollama/models", async (req, res) => {
  const rawUrl =
    typeof req.query["baseUrl"] === "string" && req.query["baseUrl"]
      ? req.query["baseUrl"]
      : "http://localhost:11434";

  if (!isAllowedOllamaUrl(rawUrl)) {
    res.status(400).json({ models: [], error: "baseUrl must point to localhost" });
    return;
  }

  const baseUrl = rawUrl;

  try {
    const upstream = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) {
      res.status(502).json({ models: [], error: "Ollama returned an error" });
      return;
    }
    const data = (await upstream.json()) as {
      models?: Array<{ name: string }>;
    };
    const models = (data.models ?? []).map((m) => m.name);
    res.json({ models });
  } catch (err) {
    logger.warn({ err, baseUrl }, "Could not reach Ollama");
    res.status(502).json({
      models: [],
      error: "Cannot reach Ollama. Is it running? (ollama serve)",
    });
  }
});

export default router;
