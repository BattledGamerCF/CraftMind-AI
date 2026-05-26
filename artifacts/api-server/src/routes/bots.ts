import { Router, type IRouter } from "express";
import { botManager } from "../bot/BotManager.js";
import { listStructures } from "../bot/structures/StructureRegistry.js";
import { sharedWorldModel } from "../bot/core/SharedWorldModel.js";
import type { CognitiveMode } from "../bot/types.js";
import { logger } from "../lib/logger.js";

const VALID_MODES = new Set<CognitiveMode>(["deterministic", "lightweight", "balanced", "auto", "deep-reasoning"]);

const router: IRouter = Router();

router.get("/bots", (_req, res) => {
  res.json({ bots: botManager.getAllStatuses() });
});

router.post("/bots", async (req, res) => {
  const { host, port, username, version, auth, llm, behavior, role } = req.body as Record<string, unknown>;

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

  try {
    const bot = await botManager.createBot({
      host,
      port: typeof port === "number" ? port : 25565,
      username,
      version: typeof version === "string" ? version : undefined,
      auth: auth === "microsoft" ? "microsoft" : "offline",
      llm: llm as Parameters<typeof botManager.createBot>[0]["llm"],
      behavior: behavior as Parameters<typeof botManager.createBot>[0]["behavior"],
      role: role as Parameters<typeof botManager.createBot>[0]["role"],
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
  const windowMs = Number(req.query["windowMs"] ?? 5 * 60_000);
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

router.get("/swarm", (_req, res) => {
  res.json({ bots: sharedWorldModel.getBots() });
});

router.get("/structures", (_req, res) => {
  res.json({ structures: listStructures().map((s) => ({ name: s.name, displayName: s.displayName, width: s.width, height: s.height, depth: s.depth })) });
});

export default router;
