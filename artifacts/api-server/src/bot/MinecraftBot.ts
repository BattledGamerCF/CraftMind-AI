import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import type { BotConfig, BotStatus } from "./types.js";
import { FastBrain } from "./FastBrain.js";
import { SlowBrain } from "./SlowBrain.js";
import { createLLMProvider } from "./llm/ProviderFactory.js";
import { logger } from "../lib/logger.js";

export class MinecraftBot {
  readonly id: string;
  private bot: Bot | null = null;
  private fastBrain: FastBrain | null = null;
  private slowBrain: SlowBrain;
  private config: BotConfig;
  connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private destroyed = false;

  constructor(id: string, config: BotConfig) {
    this.id = id;
    this.config = config;
    const llm = createLLMProvider(config.llm);
    this.slowBrain = new SlowBrain(llm);
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

    logger.debug({ username, message: cleanMessage }, "Processing player message");

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
        await this.fastBrain.executeIntent(intent);
      }
    } catch (err) {
      logger.error({ err }, "Chat handling error");
    }
  }

  async sendCommand(command: string, args: Record<string, unknown> = {}): Promise<void> {
    if (!this.fastBrain) throw new Error("Bot not connected");

    switch (command) {
      case "stop":
        await this.fastBrain.executeIntent({ intent: "stop" });
        break;
      case "follow":
        await this.fastBrain.executeIntent({ intent: "follow_player", target: args["player"] as string });
        break;
      case "mine":
        await this.fastBrain.executeIntent({ intent: "mine_resource", target: args["resource"] as string ?? "wood" });
        break;
      case "build":
        await this.fastBrain.executeIntent({ intent: "build_structure", target: args["structure"] as string ?? "simple_shelter" });
        break;
      case "explore":
        await this.fastBrain.executeIntent({ intent: "explore" });
        break;
      case "say":
        if (args["message"]) await this.fastBrain.social.say(args["message"] as string);
        break;
      case "come":
        await this.fastBrain.executeIntent({ intent: "come_here", target: args["player"] as string });
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
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
    };
  }

  destroy() {
    this.destroyed = true;
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
