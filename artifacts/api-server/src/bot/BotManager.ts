import { randomUUID } from "node:crypto";
import { MinecraftBot } from "./MinecraftBot.js";
import type { BotConfig, BotStatus, CreateBotRequest } from "./types.js";
import type { BotRole } from "./core/SharedWorldModel.js";
import { logger } from "../lib/logger.js";

const DEFAULT_BEHAVIOR = {
  followDistance: 3,
  autoEat: true,
  defendSelf: true,
  humanize: true,
  chatCooldown: 3000,
  viewDistance: 32,
};

class BotManager {
  private bots = new Map<string, MinecraftBot>();

  async createBot(request: CreateBotRequest & { role?: BotRole }): Promise<MinecraftBot> {
    const id = randomUUID();
    const config: BotConfig = {
      host: request.host,
      port: request.port ?? 25565,
      username: request.username,
      version: request.version,
      auth: request.auth ?? "offline",
      llm: request.llm,
      behavior: { ...DEFAULT_BEHAVIOR, ...request.behavior },
      cognitiveMode: (request as BotConfig).cognitiveMode,
    };

    const bot = new MinecraftBot(id, config, request.role ?? "generalist");
    this.bots.set(id, bot);

    try {
      await bot.connect();
      logger.info({ id, username: config.username }, "Bot connected successfully");
      return bot;
    } catch (err) {
      this.bots.delete(id);
      bot.destroy();
      throw err;
    }
  }

  getBot(id: string): MinecraftBot | null {
    return this.bots.get(id) ?? null;
  }

  getAllBots(): MinecraftBot[] {
    return Array.from(this.bots.values());
  }

  getAllStatuses(): BotStatus[] {
    return Array.from(this.bots.values()).map((b) => b.getStatus());
  }

  removeBot(id: string): boolean {
    const bot = this.bots.get(id);
    if (!bot) return false;
    bot.destroy();
    this.bots.delete(id);
    logger.info({ id }, "Bot removed");
    return true;
  }

  removeAll() {
    for (const [id, bot] of this.bots) {
      bot.destroy();
      logger.info({ id }, "Bot removed during shutdown");
    }
    this.bots.clear();
  }

  count(): number {
    return this.bots.size;
  }
}

export const botManager = new BotManager();
