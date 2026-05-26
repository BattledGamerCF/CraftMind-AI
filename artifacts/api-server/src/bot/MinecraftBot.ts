import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import type { BotConfig, BotStatus, CanonicalIntent, CognitiveMode, LLMIntent } from "./types.js";
import { FastBrain } from "./FastBrain.js";
import { SlowBrain } from "./SlowBrain.js";
import { createLLMProvider } from "./llm/ProviderFactory.js";
import { sharedWorldModel, type BotRole } from "./core/SharedWorldModel.js";
import { CognitiveRouter, IntentCache, CognitionTelemetry } from "./cognition/index.js";
import { estimateProfileTokens } from "./cognition/PromptProfiles.js";
import { logger } from "../lib/logger.js";

const CONFIDENCE_CLARIFY_THRESHOLD = 0.4;
const CONFIDENCE_IGNORE_THRESHOLD = 0.2;

export class MinecraftBot {
  readonly id: string;
  private bot: Bot | null = null;
  fastBrain: FastBrain | null = null;
  private slowBrain: SlowBrain;
  private config: BotConfig;
  private role: BotRole;
  private router: CognitiveRouter;
  private intentCache: IntentCache;
  cognitionTelemetry: CognitionTelemetry;
  connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private destroyed = false;

  constructor(id: string, config: BotConfig, role: BotRole = "generalist") {
    this.id = id;
    this.config = config;
    this.role = role;
    const llm = createLLMProvider(config.llm);
    this.slowBrain = new SlowBrain(llm, config.cognitiveMode ?? "balanced");
    this.router = new CognitiveRouter();
    this.intentCache = new IntentCache();
    this.cognitionTelemetry = new CognitionTelemetry();
  }

  setMode(mode: CognitiveMode) {
    this.slowBrain.setMode(mode);
    this.router.reset(); // clear hysteresis on explicit API change
  }

  getMode(): CognitiveMode {
    return this.slowBrain.getMode();
  }

  async connect(): Promise<void> {
    if (this.destroyed) throw new Error("Bot has been destroyed");

    logger.info({ id: this.id, host: this.config.host, port: this.config.port }, "Connecting bot");

    this.bot = mineflayer.createBot({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      version: this.config.version,
      auth: this.config.auth ?? "offline",
      logErrors: false,
      hideErrors: false,
    });

    this.fastBrain = new FastBrain(this.bot, this.config.behavior);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error("Connection timeout")); }, 30000);

      this.bot!.once("spawn", async () => {
        clearTimeout(timeout);
        this.connected = true;
        this.reconnectAttempts = 0;
        logger.info({ id: this.id }, "Bot spawned");
        await this.fastBrain!.setup(async (username, message) => {
          await this.handleChat(username, message);
        });
        sharedWorldModel.registerBot({ id: this.id, username: this.config.username, role: this.role });
        resolve();
      });

      this.bot!.once("error", (err) => { clearTimeout(timeout); reject(err); });
      this.bot!.once("kicked", (reason) => { clearTimeout(timeout); reject(new Error(`Kicked: ${reason}`)); });
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    if (!this.bot) return;

    this.bot.on("end", async (reason) => {
      this.connected = false;
      logger.warn({ id: this.id, reason }, "Bot disconnected");

      if (!this.destroyed && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(5000 * this.reconnectAttempts, 30000);
        logger.info({ id: this.id, attempt: this.reconnectAttempts, delay }, "Reconnecting...");
        setTimeout(() => {
          this.connect().catch((err) => logger.error({ err, id: this.id }, "Reconnect failed"));
        }, delay);
      }
    });

    this.bot.on("error", (err) => logger.error({ err, id: this.id }, "Bot error"));
    this.bot.on("kicked", (reason) => logger.warn({ id: this.id, reason }, "Bot kicked"));
  }

  private async handleChat(username: string, message: string) {
    if (!this.fastBrain || !this.bot) return;

    const lowerMsg = message.toLowerCase();
    const botName = this.bot.username.toLowerCase();
    const isAddressed =
      lowerMsg.includes(botName) || lowerMsg.startsWith("!") ||
      lowerMsg.startsWith("@all") || message.startsWith(".");
    if (!isAddressed) return;

    const cleanMessage = message
      .replace(new RegExp(botName, "gi"), "")
      .replace(/^[!.@]/, "")
      .trim();
    if (!cleanMessage) return;

    const routeStart = Date.now();

    // Build routing context
    const botState = this.fastBrain.state;
    const decision = this.router.route({
      message: cleanMessage,
      health: this.bot.health,
      food: this.bot.food,
      state: botState,
      configuredMode: this.slowBrain.getMode(),
    });

    logger.debug({ username, effectiveMode: decision.effectiveMode, profile: decision.promptProfile }, "CognitiveRouter decision");

    // Cache lookup (skip for deep-reasoning — context too variable)
    if (decision.effectiveMode !== "deep-reasoning") {
      const cached = this.intentCache.get(cleanMessage);
      if (cached) {
        this.recordTelemetry(cached, decision, routeStart, true);
        this.submitIntent(cached, username, cleanMessage);
        return;
      }
    }

    // Deterministic fast path
    if (decision.deterministicAllowed) {
      const det = CognitiveRouter.parseDeterministic(cleanMessage);
      if (det) {
        this.intentCache.set(cleanMessage, det);
        this.recordTelemetry(det, decision, routeStart, false);
        this.submitIntent(det, username, cleanMessage);
        return;
      }
      // Deterministic parse failed — if mode is strictly deterministic, apply fallback
      if (decision.effectiveMode === "deterministic") {
        await this.applyFallback(decision.fallbackStrategy, username);
        return;
      }
      // lightweight: fall through to LLM
    }

    // LLM path
    const budget = decision.memoryBudget;
    const episodicSummary = budget.episodicEvents > 0
      ? this.fastBrain.memory.episodic.recent(budget.episodicEvents)
          .map((e) => e.description).join("; ")
      : undefined;
    const semanticSummary = budget.semanticLocations > 0
      ? this.fastBrain.memory.semantic.snapshot().locations
          .slice(0, budget.semanticLocations)
          .map((l) => `${l.name}@${Math.floor(l.position.x)},${Math.floor(l.position.z)}`)
          .join("; ")
      : undefined;

    try {
      const intent = await this.slowBrain.processChat(username, cleanMessage, {
        health: this.bot.health,
        food: this.bot.food,
        state: botState,
        nearbyPlayers: this.fastBrain.social.getNearbyPlayers(),
        inventory: this.fastBrain.inventory.getItems().map((i) => `${i.name}x${i.count}`),
        position: this.bot.entity?.position
          ? { x: this.bot.entity.position.x, y: this.bot.entity.position.y, z: this.bot.entity.position.z }
          : null,
        episodicSummary,
        semanticSummary,
      }, decision);

      if (!intent) return;

      // Confidence gating
      if (intent.confidence < CONFIDENCE_IGNORE_THRESHOLD) {
        logger.debug({ confidence: intent.confidence }, "Intent ignored: confidence too low");
        this.recordTelemetry(intent, decision, routeStart, false);
        return;
      }

      if (intent.confidence < CONFIDENCE_CLARIFY_THRESHOLD) {
        // Try deterministic downgrade before applying fallback strategy
        const det = CognitiveRouter.parseDeterministic(cleanMessage);
        if (det) {
          this.intentCache.set(cleanMessage, det);
          this.recordTelemetry(det, decision, routeStart, false);
          this.submitIntent(det, username, cleanMessage);
          return;
        }
        await this.applyFallback(decision.fallbackStrategy, username);
        this.recordTelemetry(intent, decision, routeStart, false);
        return;
      }

      this.intentCache.set(cleanMessage, intent);
      this.recordTelemetry(intent, decision, routeStart, false);
      this.submitIntent(intent, username, cleanMessage);
    } catch (err) {
      logger.error({ err }, "Chat handling error");
    }
  }

  private submitIntent(intent: CanonicalIntent | LLMIntent, username: string, message: string) {
    if (!this.fastBrain) return;
    this.fastBrain.memory.episodic.record({
      kind: "player_interaction",
      description: `${username}: "${message}" → ${"intent" in intent ? intent.intent : "?"} (${"source" in intent ? intent.source : "llm"})`,
      participants: [username],
    });
    this.fastBrain.submitIntent(intent as LLMIntent);
  }

  private async applyFallback(strategy: "clarify" | "downgrade" | "ignore", username: string) {
    if (strategy === "clarify" && this.fastBrain) {
      const clarifications = [
        `Not quite sure what you mean, ${username}.`,
        "Could you be more specific?",
        "Hmm, say that again?",
      ];
      const msg = clarifications[Math.floor(Math.random() * clarifications.length)]!;
      await this.fastBrain.social.say(msg).catch(() => {});
    }
    // downgrade and ignore: do nothing (deterministic fallback already tried above)
  }

  private recordTelemetry(
    intent: CanonicalIntent | { confidence: number; source: "deterministic" | "llm" | "cache" },
    decision: import("./types.js").CognitiveDecision,
    startMs: number,
    cacheHit: boolean
  ) {
    this.cognitionTelemetry.record({
      effectiveMode: decision.effectiveMode,
      promptTokens: cacheHit ? 0 : estimateProfileTokens(decision.promptProfile),
      routingLatencyMs: Date.now() - startMs,
      confidence: (intent as CanonicalIntent).confidence ?? 1,
      source: cacheHit ? "cache" : (intent as CanonicalIntent).source ?? "llm",
      deepReasoning: decision.effectiveMode === "deep-reasoning",
    });
  }

  async sendCommand(command: string, args: Record<string, unknown> = {}): Promise<void> {
    if (!this.fastBrain) throw new Error("Bot not connected");

    const intentMap: Record<string, () => LLMIntent | null> = {
      stop:    () => ({ intent: "stop" }),
      follow:  () => ({ intent: "follow_player", target: args["player"] as string | undefined }),
      mine:    () => ({ intent: "mine_resource", target: (args["resource"] as string) ?? "wood", params: args["count"] !== undefined ? { count: args["count"] } : undefined }),
      build:   () => ({ intent: "build_structure", target: (args["structure"] as string) ?? "simple_shelter" }),
      explore: () => ({ intent: "explore" }),
      come:    () => ({ intent: "come_here", target: args["player"] as string | undefined }),
    };

    if (command === "say") {
      if (args["message"]) await this.fastBrain.social.say(args["message"] as string);
      return;
    }

    const make = intentMap[command];
    if (!make) throw new Error(`Unknown command: ${command}`);
    const intent = make();
    if (intent) this.fastBrain.submitIntent(intent);
  }

  getStatus(): BotStatus {
    const pos = this.bot?.entity?.position;
    return {
      id: this.id,
      username: this.config.username,
      state: this.fastBrain?.state ?? "disconnected",
      health: this.bot?.health ?? 0,
      food: this.bot?.food ?? 0,
      position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
      inventory: this.fastBrain?.inventory.getItems() ?? [],
      connected: this.connected,
      server: `${this.config.host}:${this.config.port}`,
      chatHistory: this.fastBrain?.social.getHistory() ?? [],
      currentTask: this.fastBrain?.getCurrentTask() ?? null,
      cognitiveMode: this.slowBrain.getMode(),
    };
  }

  getRole(): BotRole {
    return this.role;
  }

  destroy() {
    this.destroyed = true;
    sharedWorldModel.unregisterBot(this.id);
    this.intentCache.clear();
    this.fastBrain?.teardown();
    if (this.bot) {
      try { this.bot.quit("Disconnected by user"); } catch {}
      this.bot.removeAllListeners();
      this.bot = null;
    }
    this.connected = false;
    logger.info({ id: this.id }, "Bot destroyed");
  }
}
