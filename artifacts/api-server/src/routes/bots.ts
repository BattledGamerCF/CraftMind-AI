import { Router, type IRouter } from "express";
import { botManager } from "../bot/BotManager.js";
import { listStructures } from "../bot/structures/StructureRegistry.js";
import { sharedWorldModel } from "../bot/core/SharedWorldModel.js";
import type { CognitiveMode } from "../bot/types.js";
import type { BotRole } from "../bot/core/SharedWorldModel.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";

const VALID_MODES = new Set<CognitiveMode>(["deterministic", "lightweight", "balanced", "auto", "deep-reasoning"]);
const VALID_ROLES = new Set<BotRole>(["generalist", "miner", "builder", "guard", "scout", "farmer"]);
const VALID_PLAYSTYLES = new Set(["companion", "worker", "adventurer", "safe", "auto"]);

function clampInt(v: unknown, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Math.trunc(Number(v));
  if (!isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

const router: IRouter = Router();

router.get("/bots", (_req, res) => {
  res.json({ bots: botManager.getAllStatuses() });
});

router.post("/bots", async (req, res) => {
  const { host, port, username, version, auth, llm, behavior, role, cognitiveMode, playstyle } = req.body as Record<string, unknown>;

  if (!host || typeof host !== "string") {
    res.status(400).json({ error: "host is required" });
    return;
  }
  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "username is required" });
    return;
  }
  if (!llm || typeof llm !== "object") {
    res.status(400).json({ error: "llm config is required" });
    return;
  }

  const llmConfig = llm as { provider?: string; model?: string };
  if (!llmConfig.provider || !llmConfig.model) {
    res.status(400).json({ error: "llm.provider and llm.model are required" });
    return;
  }

  if (!["ollama", "openai", "anthropic"].includes(llmConfig.provider)) {
    res.status(400).json({ error: "llm.provider must be ollama, openai, or anthropic" });
    return;
  }

  if (botManager.count() >= config.bots.maxConcurrent) {
    res.status(429).json({ error: `Bot limit reached (max ${config.bots.maxConcurrent}). Delete an existing bot first.` });
    return;
  }

  const rawRole = typeof role === "string" ? role : "generalist";
  const safeRole: BotRole = VALID_ROLES.has(rawRole as BotRole) ? (rawRole as BotRole) : "generalist";

  const rawCogMode = typeof cognitiveMode === "string" ? cognitiveMode : undefined;
  const safeCogMode = rawCogMode && VALID_MODES.has(rawCogMode as CognitiveMode)
    ? (rawCogMode as CognitiveMode)
    : undefined;

  const rawPlaystyle = typeof playstyle === "string" ? playstyle : undefined;
  const safePlaystyle = rawPlaystyle && VALID_PLAYSTYLES.has(rawPlaystyle)
    ? (rawPlaystyle as "companion" | "worker" | "adventurer" | "safe" | "auto")
    : undefined;

  const rawBehavior = behavior && typeof behavior === "object" ? behavior as Record<string, unknown> : {};
  const safeBehavior = {
    followDistance:  clampInt(rawBehavior["followDistance"],  1, 20),
    chatCooldown:    clampInt(rawBehavior["chatCooldown"],    500, 30_000),
    viewDistance:    clampInt(rawBehavior["viewDistance"],    4, 64),
    autoEat:         typeof rawBehavior["autoEat"]    === "boolean" ? rawBehavior["autoEat"]    : undefined,
    defendSelf:      typeof rawBehavior["defendSelf"] === "boolean" ? rawBehavior["defendSelf"] : undefined,
    humanize:        typeof rawBehavior["humanize"]   === "boolean" ? rawBehavior["humanize"]   : undefined,
  };

  try {
    const bot = await botManager.createBot({
      host,
      port: typeof port === "number" ? Math.max(1, Math.min(65535, Math.trunc(port))) : 25565,
      username,
      version: typeof version === "string" ? version : undefined,
      auth: auth === "microsoft" ? "microsoft" : "offline",
      llm: llm as Parameters<typeof botManager.createBot>[0]["llm"],
      behavior: safeBehavior,
      role: safeRole,
      cognitiveMode: safeCogMode,
      playstyle: safePlaystyle,
    });

    res.status(201).json({ bot: bot.getStatus() });
  } catch (err) {
    logger.error({ err }, "Failed to create bot");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to connect bot" });
  }
});

router.get("/bots/:id", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  res.json({ bot: bot.getStatus() });
});

router.delete("/bots/:id", (req, res) => {
  const removed = botManager.removeBot(req.params["id"]!);
  if (!removed) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  res.json({ success: true });
});

router.post("/bots/:id/command", async (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }

  const { command, args } = req.body as { command?: string; args?: Record<string, unknown> };
  if (!command || typeof command !== "string") {
    res.status(400).json({ error: "command is required" });
    return;
  }

  try {
    await bot.sendCommand(command, args ?? {});
    res.json({ success: true, status: bot.getStatus() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Command failed" });
  }
});

router.get("/bots/:id/inventory", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  res.json({ inventory: bot.getStatus().inventory });
});

router.get("/bots/:id/chat", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  res.json({ chat: bot.getStatus().chatHistory });
});

// --- New visibility endpoints: tasks, plans, perception, memory, telemetry ---

router.get("/bots/:id/tasks", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot?.fastBrain) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json({
    current: bot.fastBrain.arbitrator.getCurrent(),
    queue: bot.fastBrain.arbitrator.getQueue(),
    all: bot.fastBrain.arbitrator.getAllTasks(),
  });
});

router.post("/bots/:id/tasks/cancel-all", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot?.fastBrain) { res.status(404).json({ error: "Bot not found" }); return; }
  bot.fastBrain.arbitrator.cancelAll("api_cancel_all");
  res.json({ success: true });
});

router.get("/bots/:id/perception", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot?.fastBrain) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json({ perception: bot.fastBrain.perception.get() });
});

router.get("/bots/:id/memory", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot?.fastBrain) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json({
    shortTerm: bot.fastBrain.memory.shortTerm.snapshot(),
    episodic: bot.fastBrain.memory.episodic.recent(20),
    semantic: bot.fastBrain.memory.semantic.snapshot(),
  });
});

router.get("/bots/:id/telemetry", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot?.fastBrain) { res.status(404).json({ error: "Bot not found" }); return; }
  const windowMs = Math.max(1_000, Math.min(Number(req.query["windowMs"] ?? 5 * 60_000), 24 * 60 * 60_000));
  res.json({
    stats: bot.fastBrain.telemetry.getStats(),
    failures: bot.fastBrain.telemetry.summarizeFailures(windowMs),
    recent: bot.fastBrain.telemetry.getRecords(50),
  });
});

router.get("/bots/:id/cognition", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json({
    mode: bot.getMode(),
    telemetry: bot.cognitionTelemetry.getStats(),
  });
});

router.get("/bots/:id/mode", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json({ mode: bot.getMode() });
});

router.patch("/bots/:id/mode", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  const { mode } = req.body as { mode?: string };
  if (!mode || !VALID_MODES.has(mode as CognitiveMode)) {
    res.status(400).json({ error: `mode must be one of: ${[...VALID_MODES].join(", ")}` });
    return;
  }
  bot.setMode(mode as CognitiveMode);
  logger.info({ id: req.params["id"], mode }, "Cognitive mode changed via API");
  res.json({ mode });
});

router.get("/bots/:id/trust", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json({ trust: bot.getTrustSnapshot() });
});

router.get("/bots/:id/playstyle", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json({ ...bot.getPlaystyle(), operationalState: bot.getOperationalState() });
});

router.patch("/bots/:id/playstyle", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  const { profile } = req.body as { profile?: string };
  if (!profile || !VALID_PLAYSTYLES.has(profile)) {
    res.status(400).json({ error: `profile must be one of: ${[...VALID_PLAYSTYLES].join(", ")}` });
    return;
  }
  bot.setPlaystyle(profile as Parameters<typeof bot.setPlaystyle>[0]);
  logger.info({ id: req.params["id"], profile }, "Playstyle changed via API");
  res.json({ ...bot.getPlaystyle(), operationalState: bot.getOperationalState() });
});

/**
 * GET /api/bots/:id/runtime
 * Compact single-call snapshot of everything relevant to bot state.
 * Replaces the need to call /tasks + /memory + /perception + /playstyle separately.
 */
router.get("/bots/:id/runtime", (req, res) => {
  const bot = botManager.getBot(req.params["id"]!);
  if (!bot?.fastBrain) { res.status(404).json({ error: "Bot not found" }); return; }
  const fb = bot.fastBrain;
  const mem = fb.memory;

  res.json({
    task: {
      current: fb.arbitrator.getCurrent() ?? null,
      queueLength: fb.arbitrator.getQueue().length,
    },
    zone: fb.getCurrentZone(),
    operationalState: fb.operationalState,
    cognitiveMode: bot.getMode(),
    playstyle: bot.getPlaystyle(),
    riskScore: Number(fb.getLastRiskScore().toFixed(3)),
    alertness: Number(fb.humanization.getAlertness().toFixed(3)),
    memory: {
      goal: mem.shortTerm.currentGoal ?? null,
      threatCount: mem.shortTerm.snapshot().nearbyThreats.length,
      episodicEventCount: mem.episodic.count(),
      recentEvents: mem.episodic.recent(5).map((e) => ({
        kind: e.kind,
        description: e.description,
        minsAgo: Math.round((Date.now() - e.timestamp) / 60_000),
      })),
      waypointCount: mem.semantic.snapshot().locations.length,
    },
    telemetry: fb.telemetry.getStats(),
  });
});

router.get("/swarm", (_req, res) => {
  res.json({ bots: sharedWorldModel.getBots() });
});

router.get("/structures", (_req, res) => {
  res.json({ structures: listStructures().map((s) => ({ name: s.name, displayName: s.displayName, width: s.width, height: s.height, depth: s.depth })) });
});

export default router;
