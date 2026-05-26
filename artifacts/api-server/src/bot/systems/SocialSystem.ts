import type { Bot } from "mineflayer";
import type { ChatMessage } from "../types.js";
import { logger } from "../../lib/logger.js";

export class SocialSystem {
  private bot: Bot;
  private chatHistory: ChatMessage[] = [];
  private maxHistory = 50;
  private lastChatTime = 0;
  private chatCooldown: number;
  private onChatCallback: ((username: string, message: string) => void) | null = null;

  constructor(bot: Bot, chatCooldown = 3000) {
    this.bot = bot;
    this.chatCooldown = chatCooldown;
  }

  setup(onChat: (username: string, message: string) => void) {
    this.onChatCallback = onChat;

    this.bot.on("chat", (username, message) => {
      if (username === this.bot.username) return;
      this.addToHistory(username, message, "chat");
      onChat(username, message);
    });

    this.bot.on("whisper", (username, message) => {
      this.addToHistory(username, message, "whisper");
      onChat(username, `[whisper] ${message}`);
    });
  }

  private addToHistory(username: string, message: string, type: ChatMessage["type"]) {
    this.chatHistory.push({ timestamp: Date.now(), username, message, type });
    if (this.chatHistory.length > this.maxHistory) {
      this.chatHistory.shift();
    }
  }

  async say(message: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastChatTime < this.chatCooldown) return;
    if (!message.trim()) return;

    this.lastChatTime = now;
    try {
      this.bot.chat(message);
      this.addToHistory(this.bot.username, message, "chat");
      logger.debug({ message }, "Bot sent chat");
    } catch (err) {
      logger.debug({ err }, "Failed to send chat");
    }
  }

  getHistory(): ChatMessage[] {
    return [...this.chatHistory];
  }

  getRecentHistory(count = 10): ChatMessage[] {
    return this.chatHistory.slice(-count);
  }

  getNearbyPlayers(): string[] {
    const playerNames = Object.keys(this.bot.players).filter(
      (name) => name !== this.bot.username
    );
    return playerNames;
  }

  getClosestPlayer(): { name: string; distance: number } | null {
    let closest: { name: string; distance: number } | null = null;

    for (const [name, player] of Object.entries(this.bot.players)) {
      if (name === this.bot.username || !player.entity) continue;
      const dist = this.bot.entity.position.distanceTo(player.entity.position);
      if (!closest || dist < closest.distance) {
        closest = { name, distance: dist };
      }
    }

    return closest;
  }

  clearHistory() {
    this.chatHistory = [];
  }
}
