import type { LLMProvider } from "./llm/LLMProvider.js";
import type { LLMIntent, LLMMessage, ChatMessage } from "./types.js";
import { logger } from "../lib/logger.js";

const SYSTEM_PROMPT = `You are a Minecraft bot companion. You are helpful, concise, and action-oriented.

When a player talks to you, respond with a JSON object describing what you should do.

Available intents:
- idle: do nothing
- follow_player: follow the specified player (target = player name)
- mine_resource: gather resources (target = "wood", "stone", "coal", "iron", "diamond")
- build_structure: build something (target = "oak_cabin" or "simple_shelter")
- explore: wander and explore the area
- come_here: teleport/walk to the player who spoke (target = player name)
- stop: stop whatever you're doing
- gather_food: find and collect food
- report_status: report your current status
- defend_self: defend against attackers

Response format (JSON ONLY, no extra text):
{
  "intent": "<intent>",
  "target": "<optional target>",
  "chat": "<short message to send in Minecraft chat, max 12 words, conversational and natural>",
  "params": {}
}

Rules:
- Always use the JSON format. No plain text.
- Keep chat messages SHORT and natural sounding (max 12 words).
- Prefer actions over explanations.
- Only say something in chat if it adds value.
- Do not narrate your actions ("Mining block", "Pathfinding initiated" etc).
- Talk like a slightly awkward but helpful player, not a robot.`;

export class SlowBrain {
  private llm: LLMProvider;
  private conversationHistory: LLMMessage[] = [];
  private maxHistory = 10;
  private processing = false;
  private lastProcessedTime = 0;
  private minProcessInterval = 1500;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  async processChat(
    playerName: string,
    message: string,
    context: {
      health: number;
      food: number;
      state: string;
      nearbyPlayers: string[];
      inventory: string[];
      position: { x: number; y: number; z: number } | null;
    }
  ): Promise<LLMIntent | null> {
    if (this.processing) return null;
    const now = Date.now();
    if (now - this.lastProcessedTime < this.minProcessInterval) return null;

    this.processing = true;
    this.lastProcessedTime = now;

    try {
      const contextStr = [
        `State: ${context.state}`,
        `Health: ${context.health}/20, Food: ${context.food}/20`,
        `Nearby players: ${context.nearbyPlayers.join(", ") || "none"}`,
        `Inventory highlights: ${context.inventory.slice(0, 6).join(", ") || "empty"}`,
        context.position ? `Position: ${Math.floor(context.position.x)}, ${Math.floor(context.position.y)}, ${Math.floor(context.position.z)}` : "",
      ].filter(Boolean).join("\n");

      const userMessage: LLMMessage = {
        role: "user",
        content: `[World context]\n${contextStr}\n\n[${playerName} says]: ${message}`,
      };

      this.conversationHistory.push(userMessage);
      if (this.conversationHistory.length > this.maxHistory) {
        this.conversationHistory = this.conversationHistory.slice(-this.maxHistory);
      }

      const response = await this.llm.chat([...this.conversationHistory], SYSTEM_PROMPT);
      logger.debug({ response }, "SlowBrain response");

      const assistantMessage: LLMMessage = { role: "assistant", content: response };
      this.conversationHistory.push(assistantMessage);

      return this.parseIntent(response);
    } catch (err) {
      logger.error({ err }, "SlowBrain processing error");
      return null;
    } finally {
      this.processing = false;
    }
  }

  private parseIntent(response: string): LLMIntent | null {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]) as LLMIntent;
      if (!parsed.intent) return null;
      return parsed;
    } catch {
      logger.warn({ response }, "Failed to parse LLM intent");
      return null;
    }
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  isProcessing(): boolean {
    return this.processing;
  }
}
