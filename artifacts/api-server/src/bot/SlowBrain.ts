import type { LLMProvider } from "./llm/LLMProvider.js";
import type { LLMIntent, LLMMessage, CognitiveMode } from "./types.js";
import { logger } from "../lib/logger.js";

// ── Prompt variants ──────────────────────────────────────────────────────────

const INTENTS_BLOCK = `idle|follow_player|mine_resource|build_structure|explore|come_here|stop|gather_food|report_status|defend_self`;

const SYSTEM_PROMPT_FULL = `You are a Minecraft bot companion. You are helpful, concise, and action-oriented.

When a player talks to you, respond with a JSON object describing what you should do.

Available intents: ${INTENTS_BLOCK}
Targets: follow_player/come_here → player name | mine_resource → wood/stone/coal/iron/diamond | build_structure → oak_cabin/simple_shelter

Response format (JSON ONLY):
{"intent":"<intent>","target":"<optional>","chat":"<max 12 words>","params":{}}

Rules: JSON only. Short natural chat. Prefer action over explanation. Talk like a slightly awkward but helpful player.`;

const SYSTEM_PROMPT_COMPACT = `Minecraft bot. Reply JSON only.
Intents: ${INTENTS_BLOCK}
Format: {"intent":"...","target":"...","chat":"...","params":{}}
Keep chat ≤8 words. Action > explanation.`;

const SYSTEM_PROMPT_DEEP = `You are a Minecraft bot companion with full planning capability.

When a player talks to you, return a JSON object. Think carefully about complex, multi-step, or novel requests before responding.

Available intents: ${INTENTS_BLOCK}
Targets: follow_player/come_here → player name | mine_resource → wood/stone/coal/iron/diamond | build_structure → oak_cabin/simple_shelter

Response format (JSON ONLY):
{"intent":"<intent>","target":"<optional>","chat":"<max 15 words, allowed to be more descriptive>","params":{}}

Rules:
- JSON only. No extra text.
- For complex tasks, pick the best single intent that starts the chain.
- Use params to convey additional context (count, location hints, etc).
- Talk like a knowledgeable but slightly awkward player.`;

// ── Auto-mode escalation heuristics ─────────────────────────────────────────

interface AutoCtx {
  health: number;
  food: number;
  state: string;
  message: string;
}

function selectAutoMode(ctx: AutoCtx): Exclude<CognitiveMode, "auto"> {
  const msg = ctx.message.toLowerCase();

  // Urgent / reactive — skip heavy reasoning
  if (ctx.state === "combat" || ctx.state === "fleeing" || ctx.health < 6) {
    return "lightweight";
  }

  // Signs of a complex/novel request → escalate
  const complexSignals = [
    /build.*(?:town|city|castle|fortress|farm|village|mine|base)/,
    /integrat|coordin|strateg|plan|design|optimiz/,
    /multiple|several|all|every/,
    /biome|terrain|mountain|valley/,
  ];
  if (complexSignals.some((r) => r.test(msg)) || msg.split(" ").length > 12) {
    return "deep-reasoning";
  }

  // Short, clear, known-keyword messages → lightweight
  const simpleKeywords = /^(stop|follow|come|mine|build|explore|eat|status|defend|report)\b/;
  if (msg.split(" ").length <= 4 && simpleKeywords.test(msg.trim())) {
    return "lightweight";
  }

  return "balanced";
}

// ── SlowBrain ────────────────────────────────────────────────────────────────

export class SlowBrain {
  private llm: LLMProvider;
  private mode: CognitiveMode;
  private conversationHistory: LLMMessage[] = [];
  private maxHistory = 10;
  private processing = false;
  private lastProcessedTime = 0;
  private minProcessInterval = 1500;

  constructor(llm: LLMProvider, mode: CognitiveMode = "balanced") {
    this.llm = llm;
    this.mode = mode;
  }

  setMode(mode: CognitiveMode) {
    this.mode = mode;
    logger.info({ mode }, "SlowBrain cognitive mode changed");
  }

  getMode(): CognitiveMode {
    return this.mode;
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
    // Deterministic: skip LLM entirely
    if (this.mode === "deterministic") return null;

    if (this.processing) return null;
    const now = Date.now();
    if (now - this.lastProcessedTime < this.minProcessInterval) return null;

    this.processing = true;
    this.lastProcessedTime = now;

    try {
      // Resolve effective mode for this call
      const effectiveMode: Exclude<CognitiveMode, "auto"> =
        this.mode === "auto"
          ? selectAutoMode({ health: context.health, food: context.food, state: context.state, message })
          : this.mode;

      const { systemPrompt, maxTokens, historyLen } = this.getModeConfig(effectiveMode);

      const contextStr = this.buildContextString(context, effectiveMode);
      const userMessage: LLMMessage = {
        role: "user",
        content: `[Context]\n${contextStr}\n\n[${playerName}]: ${message}`,
      };

      const trimmedHistory = this.conversationHistory.slice(-historyLen);
      trimmedHistory.push(userMessage);

      this.conversationHistory.push(userMessage);
      if (this.conversationHistory.length > this.maxHistory) {
        this.conversationHistory = this.conversationHistory.slice(-this.maxHistory);
      }

      logger.debug({ effectiveMode, playerName }, "SlowBrain processing chat");

      // maxTokens is advisory — respected by providers that support it in a future extension
      void maxTokens;
      const response = await this.llm.chat(trimmedHistory, systemPrompt);

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

  private getModeConfig(mode: Exclude<CognitiveMode, "auto">): {
    systemPrompt: string;
    maxTokens: number | undefined;
    historyLen: number;
  } {
    switch (mode) {
      case "deterministic":
        return { systemPrompt: "", maxTokens: 0, historyLen: 0 };
      case "lightweight":
        return { systemPrompt: SYSTEM_PROMPT_COMPACT, maxTokens: 120, historyLen: 4 };
      case "deep-reasoning":
        return { systemPrompt: SYSTEM_PROMPT_DEEP, maxTokens: 800, historyLen: 10 };
      case "balanced":
      default:
        return { systemPrompt: SYSTEM_PROMPT_FULL, maxTokens: undefined, historyLen: 6 };
    }
  }

  private buildContextString(
    context: { health: number; food: number; state: string; nearbyPlayers: string[]; inventory: string[]; position: { x: number; y: number; z: number } | null },
    mode: Exclude<CognitiveMode, "auto">
  ): string {
    if (mode === "lightweight") {
      // Minimal context to keep prompt short
      return [
        `State:${context.state} HP:${context.health} Food:${context.food}`,
        context.nearbyPlayers.length ? `Players:${context.nearbyPlayers.join(",")}` : "",
      ].filter(Boolean).join(" ");
    }

    return [
      `State: ${context.state}`,
      `Health: ${context.health}/20, Food: ${context.food}/20`,
      `Nearby players: ${context.nearbyPlayers.join(", ") || "none"}`,
      `Inventory: ${context.inventory.slice(0, mode === "deep-reasoning" ? 12 : 6).join(", ") || "empty"}`,
      context.position ? `Position: ${Math.floor(context.position.x)}, ${Math.floor(context.position.y)}, ${Math.floor(context.position.z)}` : "",
    ].filter(Boolean).join("\n");
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
