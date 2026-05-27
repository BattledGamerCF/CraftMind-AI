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
  private sentMessages = new Map<string, number>(); // normalized text → lastSentAt
  private readonly DEDUP_WINDOW = 30_000;

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

  private isDuplicateMessage(message: string): boolean {
    // Normalize: lowercase, strip punctuation, first 40 chars
    const key = message.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().slice(0, 40);
    const last = this.sentMessages.get(key);
    if (last && Date.now() - last < this.DEDUP_WINDOW) return true;
    this.sentMessages.set(key, Date.now());
    // Prune old entries
    if (this.sentMessages.size > 30) {
      const cutoff = Date.now() - this.DEDUP_WINDOW;
      for (const [k, t] of this.sentMessages) if (t < cutoff) this.sentMessages.delete(k);
    }
    return false;
  }

  async say(message: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastChatTime < this.chatCooldown) return;
    if (!message.trim()) return;
    if (this.isDuplicateMessage(message)) return;

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
