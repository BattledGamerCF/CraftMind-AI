import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import type { BotConfig, BotStatus, CognitiveMode, LLMIntent } from "./types.js";
import { FastBrain } from "./FastBrain.js";
import { SlowBrain } from "./SlowBrain.js";
import { createLLMProvider } from "./llm/ProviderFactory.js";
import { sharedWorldModel, type BotRole } from "./core/SharedWorldModel.js";
import { logger } from "../lib/logger.js";

/**
 * Parse a player chat message into a deterministic LLMIntent using keyword matching.
 * Used when cognitiveMode === "deterministic" to skip the LLM entirely.
 */
function parseLocalIntent(message: string): LLMIntent | null {
  const m = message.toLowerCase().trim();
  if (/\bstop\b/.test(m)) return { intent: "stop" };
  if (/\bfollow\b/.test(m)) return { intent: "follow_player" };
  if (/\bcome\b/.test(m)) return { intent: "come_here" };
  if (/\bexplore\b/.test(m)) return { intent: "explore" };
  if (/\b(status|report)\b/.test(m)) return { intent: "report_status" };
  if (/\b(defend|fight|attack)\b/.test(m)) return { intent: "defend_self" };
  if (/\b(eat|food|hungry)\b/.test(m)) return { intent: "gather_food" };
  const mineMatch = m.match(/\bmine\b.*?\b(wood|stone|coal|iron|diamond|log)\b/);
  if (mineMatch) return { intent: "mine_resource", target: mineMatch[1] };
  if (/\bmine\b/.test(m)) return { intent: "mine_resource", target: "wood" };
  const buildMatch = m.match(/\bbuild\b.*?\b(cabin|shelter|oak_cabin|simple_shelter)\b/);
  if (buildMatch) {
    const target = /cabin/.test(buildMatch[1] ?? "") ? "oak_cabin" : "simple_shelter";
    return { intent: "build_structure", target };
  }
  if (/\bbuild\b/.test(m)) return { intent: "build_structure", target: "simple_shelter" };
  return null;
}

export class MinecraftBot {
  readonly id: string;
  private bot: Bot | null = null;
  fastBrain: FastBrain | null = null;
  private slowBrain: SlowBrain;
  private config: BotConfig;
  private role: BotRole;
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
  }

  setMode(mode: CognitiveMode) {
    this.slowBrain.setMode(mode);
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
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 30000);

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

      this.bot!.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.bot!.once("kicked", (reason) => {
        clearTimeout(timeout);
        reject(new Error(`Kicked: ${reason}`));
      });
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
          this.connect().catch((err) => {
            logger.error({ err, id: this.id }, "Reconnect failed");
          });
        }, delay);
      }
    });

    this.bot.on("error", (err) => {
      logger.error({ err, id: this.id }, "Bot error");
    });

    this.bot.on("kicked", (reason) => {
      logger.warn({ id: this.id, reason }, "Bot kicked");
    });
  }

  private async handleChat(username: string, message: string) {
    if (!this.fastBrain || !this.bot) return;

    const lowerMsg = message.toLowerCase();
    const botName = this.bot.username.toLowerCase();

    const isAddressed =
      lowerMsg.includes(botName) ||
      lowerMsg.startsWith("!") ||
      lowerMsg.startsWith("@all") ||
      message.startsWith(".");

    if (!isAddressed) return;

    const cleanMessage = message
      .replace(new RegExp(botName, "gi"), "")
      .replace(/^[!.@]/, "")
      .trim();

    if (!cleanMessage) return;

    logger.debug({ username, message: cleanMessage, mode: this.slowBrain.getMode() }, "Processing player message");

    // Deterministic mode: parse locally, skip LLM
    if (this.slowBrain.getMode() === "deterministic") {
      const intent = parseLocalIntent(cleanMessage);
      if (intent && this.fastBrain) {
        this.fastBrain.memory.episodic.record({
          kind: "player_interaction",
          description: `${username}: "${cleanMessage}" → ${intent.intent} (deterministic)`,
          participants: [username],
        });
        this.fastBrain.submitIntent(intent);
      }
      return;
    }

    try {
      const intent = await this.slowBrain.processChat(username, cleanMessage, {
        health: this.bot.health,
        food: this.bot.food,
        state: this.fastBrain.state,
        nearbyPlayers: this.fastBrain.social.getNearbyPlayers(),
        inventory: this.fastBrain.inventory.getItems().map((i) => `${i.name}x${i.count}`),
        position: this.bot.entity?.position
          ? { x: this.bot.entity.position.x, y: this.bot.entity.position.y, z: this.bot.entity.position.z }
          : null,
      });

      if (intent) {
        this.fastBrain.memory.episodic.record({
          kind: "player_interaction",
          description: `${username}: "${cleanMessage}" → ${intent.intent}`,
          participants: [username],
        });
        this.fastBrain.submitIntent(intent);
      }
    } catch (err) {
      logger.error({ err }, "Chat handling error");
    }
  }

  async sendCommand(command: string, args: Record<string, unknown> = {}): Promise<void> {
    if (!this.fastBrain) throw new Error("Bot not connected");

    const intentMap: Record<string, () => LLMIntent | null> = {
      stop: () => ({ intent: "stop" }),
      follow: () => ({ intent: "follow_player", target: args["player"] as string | undefined }),
      mine: () => ({ intent: "mine_resource", target: (args["resource"] as string) ?? "wood", params: args["count"] !== undefined ? { count: args["count"] } : undefined }),
      build: () => ({ intent: "build_structure", target: (args["structure"] as string) ?? "simple_shelter" }),
      explore: () => ({ intent: "explore" }),
      come: () => ({ intent: "come_here", target: args["player"] as string | undefined }),
      say: () => null, // handled below
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
    this.fastBrain?.teardown();
    if (this.bot) {
      try {
        this.bot.quit("Disconnected by user");
      } catch {
      }
      this.bot.removeAllListeners();
      this.bot = null;
    }
    this.connected = false;
    logger.info({ id: this.id }, "Bot destroyed");
  }
}
