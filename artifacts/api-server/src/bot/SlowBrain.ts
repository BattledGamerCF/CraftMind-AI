import type { LLMProvider } from "./llm/LLMProvider.js";
import type { CanonicalIntent, CognitiveDecision, LLMMessage } from "./types.js";
import { getPromptProfile } from "./cognition/PromptProfiles.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const INTENTS_NEEDING_TARGET = new Set([
  "follow_player", "mine_resource", "build_structure", "come_here",
]);

function scoreConfidence(parsed: Partial<CanonicalIntent>): number {
  if (!parsed.intent) return 0;
  const needsTarget = INTENTS_NEEDING_TARGET.has(parsed.intent);
  if (needsTarget && !parsed.target) return 0.65;
  return 0.85;
}

export interface SlowBrainContext {
  health: number;
  food: number;
  state: string;
  nearbyPlayers: string[];
  inventory: string[];
  position: { x: number; y: number; z: number } | null;
  episodicSummary?: string;
  semanticSummary?: string;
}

export class SlowBrain {
  private llm: LLMProvider;
  private mode: import("./types.js").CognitiveMode;
  private conversationHistory: LLMMessage[] = [];
  private readonly maxHistory = 10;
  private processing = false;
  private lastProcessedTime = 0;
  private readonly minProcessInterval = 1500;

  // Provider health tracking — suppress duplicate "offline" log spam
  private consecutiveFailures = 0;
  private providerDegradedLoggedAt = 0;
  // Rate limiting: cap LLM calls per minute
  private callsThisMinute = 0;
  private minuteWindowStart = Date.now();

  constructor(llm: LLMProvider, mode: import("./types.js").CognitiveMode = "balanced") {
    this.llm = llm;
    this.mode = mode;
  }

  setMode(mode: import("./types.js").CognitiveMode) {
    this.mode = mode;
    logger.info({ mode }, "SlowBrain cognitive mode changed");
  }

  getMode(): import("./types.js").CognitiveMode {
    return this.mode;
  }

  async processChat(
    playerName: string,
    message: string,
    context: SlowBrainContext,
    decision: CognitiveDecision
  ): Promise<CanonicalIntent | null> {
    if (this.processing) return null;
    const now = Date.now();
    if (now - this.lastProcessedTime < this.minProcessInterval) return null;

    // Per-minute rate limit
    if (now - this.minuteWindowStart >= 60_000) {
      this.callsThisMinute = 0;
      this.minuteWindowStart = now;
    }
    const maxCalls = config.safety.llmMaxCallsPerMinute;
    if (this.callsThisMinute >= maxCalls) {
      logger.debug({ callsThisMinute: this.callsThisMinute, maxCalls }, "SlowBrain: LLM rate limit reached");
      return null;
    }
    this.callsThisMinute++;

    this.processing = true;
    this.lastProcessedTime = now;

    try {
      const systemPrompt = getPromptProfile(decision.promptProfile);
      const historyWindow = decision.memoryBudget.chatHistorySize;
      const contextStr = this.buildContextString(context, decision);

      const userMessage: LLMMessage = {
        role: "user",
        content: `[Context]\n${contextStr}\n\n[${playerName}]: ${message}`,
      };

      this.conversationHistory.push(userMessage);
      if (this.conversationHistory.length > this.maxHistory) {
        this.conversationHistory = this.conversationHistory.slice(-this.maxHistory);
      }

      const trimmedHistory = this.conversationHistory.slice(-Math.max(historyWindow, 1));
      logger.debug({ profile: decision.promptProfile, historyWindow, playerName }, "SlowBrain processing");

      const response = await this.llm.chat(trimmedHistory, systemPrompt);

      const assistantMessage: LLMMessage = { role: "assistant", content: response };
      this.conversationHistory.push(assistantMessage);

      this.consecutiveFailures = 0; // reset on success
      return this.parseIntent(response);
    } catch (err) {
      this.consecutiveFailures++;
      const now = Date.now();

      if (this.consecutiveFailures >= 3 && now - this.providerDegradedLoggedAt > 60_000) {
        this.providerDegradedLoggedAt = now;
        logger.warn(
          {
            provider: this.llm.providerName,
            model: this.llm.modelName,
            failures: this.consecutiveFailures,
          },
          "LLM provider appears offline or unresponsive. " +
          "For Ollama: ensure `ollama serve` is running and the model is pulled (`ollama pull llama3.2`). " +
          "For cloud providers: check API key and network access.",
        );
      } else {
        logger.debug({ err, provider: this.llm.providerName }, "SlowBrain LLM call failed");
      }

      const fallback = this.keywordFallback(playerName, message);
      if (fallback) {
        logger.info({ subsystems: "llm→keyword", intent: fallback.intent, provider: this.llm.providerName },
          "[conflict] LLM failed — deterministic keyword fallback active");
      }
      return fallback;
    } finally {
      this.processing = false;
    }
  }

  /**
   * Deterministic keyword fallback — used when the LLM is unavailable.
   * Parses common commands so the bot remains responsive even with no model running.
   */
  private keywordFallback(playerName: string, message: string): CanonicalIntent | null {
    const m = message.toLowerCase();
    if (/\b(follow|come here|come to me|stay with)\b/.test(m)) {
      return { intent: "follow_player", target: playerName, confidence: 0.7, source: "deterministic" };
    }
    if (/\b(stop|halt|wait|stand still|stay)\b/.test(m)) {
      return { intent: "stop", confidence: 0.9, source: "deterministic" };
    }
    if (/\b(mine|dig|gather|collect|get (wood|stone|coal|iron|ore))\b/.test(m)) {
      const resource = /wood/.test(m) ? "wood" : /stone/.test(m) ? "stone" : /coal/.test(m) ? "coal" : /iron/.test(m) ? "iron" : undefined;
      return { intent: "mine_resource", target: resource, confidence: 0.7, source: "deterministic" };
    }
    if (/\b(build|make|construct|shelter|cabin|house)\b/.test(m)) {
      const structure = /cabin/.test(m) ? "oak_cabin" : "simple_shelter";
      return { intent: "build_structure", target: structure, confidence: 0.65, source: "deterministic" };
    }
    return null;
  }

  private buildContextString(context: SlowBrainContext, decision: CognitiveDecision): string {
    const budget = decision.memoryBudget;
    const isCompact = decision.effectiveMode === "lightweight";

    if (isCompact) {
      return [
        `State:${context.state} HP:${context.health} Food:${context.food}`,
        context.nearbyPlayers.length ? `Players:${context.nearbyPlayers.slice(0, 3).join(",")}` : "",
      ].filter(Boolean).join(" ");
    }

    const inventoryLimit = decision.effectiveMode === "deep-reasoning" ? 12 : 6;
    const lines = [
      `State: ${context.state}`,
      `Health: ${context.health}/20, Food: ${context.food}/20`,
      `Nearby players: ${context.nearbyPlayers.join(", ") || "none"}`,
      `Inventory: ${context.inventory.slice(0, inventoryLimit).join(", ") || "empty"}`,
      context.position
        ? `Position: ${Math.floor(context.position.x)}, ${Math.floor(context.position.y)}, ${Math.floor(context.position.z)}`
        : "",
    ];

    if (budget.episodicEvents > 0 && context.episodicSummary) {
      lines.push(`Recent events: ${context.episodicSummary}`);
    }
    if (budget.semanticLocations > 0 && context.semanticSummary) {
      lines.push(`Known locations: ${context.semanticSummary}`);
    }

    return lines.filter(Boolean).join("\n");
  }

  private parseIntent(response: string): CanonicalIntent | null {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]) as Partial<CanonicalIntent>;
      if (!parsed.intent) return null;
      return {
        intent: parsed.intent,
        target: parsed.target,
        chat: parsed.chat,
        params: parsed.params,
        confidence: scoreConfidence(parsed),
        source: "llm",
      };
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
