import type { CognitiveMode, CanonicalIntent, CognitiveDecision, MemoryBudget } from "../types.js";
import type { PromptProfileKey } from "./PromptProfiles.js";
import { logger } from "../../lib/logger.js";

/** Ms before a lower-urgency mode can displace a higher-urgency one. */
const HYSTERESIS_MS = 5_000;

/** Higher = faster / more reactive. Determines whether a new mode can override. */
const MODE_URGENCY: Record<Exclude<CognitiveMode, "auto">, number> = {
  deterministic: 100,
  lightweight: 80,
  balanced: 50,
  "deep-reasoning": 20,
};

/** Keyword → intent for deterministic / lightweight fast path */
const KEYWORD_RULES: Array<{ test: RegExp; intent: CanonicalIntent["intent"]; target?: (m: RegExpMatchArray) => string | undefined }> = [
  { test: /\bstop\b/, intent: "stop" },
  { test: /\bfollow\b/, intent: "follow_player" },
  { test: /\bcome\b/, intent: "come_here" },
  { test: /\bexplore\b/, intent: "explore" },
  { test: /\b(status|report)\b/, intent: "report_status" },
  { test: /\b(defend|fight|attack)\b/, intent: "defend_self" },
  { test: /\b(eat|food|hungry)\b/, intent: "gather_food" },
  {
    test: /\bmine\b.*?\b(wood|stone|coal|iron|diamond|log)\b/,
    intent: "mine_resource",
    target: (m) => m[1],
  },
  { test: /\bmine\b/, intent: "mine_resource", target: () => "wood" },
  {
    test: /\bbuild\b.*?\b(cabin|oak_cabin)\b/,
    intent: "build_structure",
    target: () => "oak_cabin",
  },
  {
    test: /\bbuild\b.*?\b(shelter|simple_shelter)\b/,
    intent: "build_structure",
    target: () => "simple_shelter",
  },
  { test: /\bbuild\b/, intent: "build_structure", target: () => "simple_shelter" },
  { test: /\b(go\s+home|return\s+home|head\s+home)\b/, intent: "return_home" },
  { test: /\bset\s+home\b/, intent: "set_home" },
  { test: /\b(clean\s*(up)?\s*(inventory)?|toss\s+junk|drop\s+junk)\b/, intent: "cleanup_inventory" },
];

interface RoutingContext {
  message: string;
  health: number;
  food: number;
  state: string;
  configuredMode: CognitiveMode;
}

interface HysteresisState {
  lastEffectiveMode: Exclude<CognitiveMode, "auto"> | null;
  lastSwitchedAt: number;
}

const MEMORY_BUDGETS: Record<Exclude<CognitiveMode, "auto">, MemoryBudget> = {
  deterministic: { chatHistorySize: 0, episodicEvents: 0, semanticLocations: 0, shortTermEntries: 0 },
  lightweight:   { chatHistorySize: 2, episodicEvents: 0, semanticLocations: 2, shortTermEntries: 3 },
  balanced:      { chatHistorySize: 6, episodicEvents: 3, semanticLocations: 5, shortTermEntries: 8 },
  "deep-reasoning": { chatHistorySize: 10, episodicEvents: 8, semanticLocations: 10, shortTermEntries: 15 },
};

const TOKEN_BUDGETS: Record<Exclude<CognitiveMode, "auto">, number> = {
  deterministic: 0,
  lightweight: 120,
  balanced: 300,
  "deep-reasoning": 800,
};

function resolveEffectiveMode(
  configuredMode: CognitiveMode,
  ctx: RoutingContext
): Exclude<CognitiveMode, "auto"> {
  if (configuredMode !== "auto") return configuredMode;

  // Auto escalation heuristics
  const msg = ctx.message.toLowerCase();

  // Reactive urgency: combat/death/danger → lightweight (fast)
  if (ctx.state === "combat" || ctx.state === "fleeing" || ctx.health < 6) return "lightweight";

  // Complex/novel signals → deep reasoning
  const complexSignals = [
    /build.*(?:town|city|castle|fortress|farm|village|base)/,
    /integrat|coordin|strateg|plan|design|optimiz/,
    /multiple|several|all|every/,
    /biome|terrain|mountain|valley/,
  ];
  if (complexSignals.some((r) => r.test(msg)) || msg.split(" ").length > 12) return "deep-reasoning";

  // Short, clear keyword → lightweight (no need for LLM)
  const simpleKeyword = /^(stop|follow|come|mine|build|explore|eat|status|defend|report)\b/;
  if (msg.split(" ").length <= 4 && simpleKeyword.test(msg.trim())) return "lightweight";

  return "balanced";
}

function selectPromptProfile(
  effectiveMode: Exclude<CognitiveMode, "auto">,
  state: string
): PromptProfileKey {
  if (effectiveMode === "deterministic") return "lightweight";
  if (effectiveMode === "lightweight") return "lightweight";
  if (effectiveMode === "deep-reasoning") return "deep-reasoning";

  // balanced: select by bot state
  if (state === "combat" || state === "fleeing") return "combat";
  if (state === "building") return "builder";
  if (state === "mining" || state === "exploring") return "planning";
  return "balanced";
}

export class CognitiveRouter {
  private hysteresis: HysteresisState = { lastEffectiveMode: null, lastSwitchedAt: 0 };

  route(ctx: RoutingContext): CognitiveDecision {
    const rawEffective = resolveEffectiveMode(ctx.configuredMode, ctx);
    const effectiveMode = this.applyHysteresis(rawEffective);
    const promptProfile = selectPromptProfile(effectiveMode, ctx.state);
    const memoryBudget = MEMORY_BUDGETS[effectiveMode];
    const tokenBudget = TOKEN_BUDGETS[effectiveMode];
    const deterministicAllowed = effectiveMode === "deterministic" || effectiveMode === "lightweight";
    const reasoningDepth: CognitiveDecision["reasoningDepth"] =
      effectiveMode === "deep-reasoning" ? "deep" :
      effectiveMode === "balanced" ? "medium" : "shallow";
    const fallbackStrategy: CognitiveDecision["fallbackStrategy"] =
      effectiveMode === "deep-reasoning" ? "clarify" : "downgrade";

    return {
      selectedMode: ctx.configuredMode,
      effectiveMode,
      promptProfile,
      tokenBudget,
      memoryBudget,
      deterministicAllowed,
      fallbackStrategy,
      reasoningDepth,
    };
  }

  private applyHysteresis(candidate: Exclude<CognitiveMode, "auto">): Exclude<CognitiveMode, "auto"> {
    const current = this.hysteresis.lastEffectiveMode;
    if (!current) {
      this.hysteresis.lastEffectiveMode = candidate;
      this.hysteresis.lastSwitchedAt = Date.now();
      return candidate;
    }

    if (candidate === current) return current;

    const candidateUrgency = MODE_URGENCY[candidate];
    const currentUrgency = MODE_URGENCY[current];
    const elapsed = Date.now() - this.hysteresis.lastSwitchedAt;

    // Higher urgency (more reactive) always overrides immediately
    if (candidateUrgency > currentUrgency) {
      logger.debug({ from: current, to: candidate }, "CognitiveRouter: immediate mode override (urgency increase)");
      this.hysteresis.lastEffectiveMode = candidate;
      this.hysteresis.lastSwitchedAt = Date.now();
      return candidate;
    }

    // Downgrade only after cooldown
    if (elapsed < HYSTERESIS_MS) {
      logger.debug({ current, candidate, elapsed }, "CognitiveRouter: hysteresis holding mode");
      return current;
    }

    logger.debug({ from: current, to: candidate }, "CognitiveRouter: mode transition after cooldown");
    this.hysteresis.lastEffectiveMode = candidate;
    this.hysteresis.lastSwitchedAt = Date.now();
    return candidate;
  }

  /** Force hysteresis reset (e.g. on mode PATCH from API) */
  reset() {
    this.hysteresis = { lastEffectiveMode: null, lastSwitchedAt: 0 };
  }

  getLastEffectiveMode(): Exclude<CognitiveMode, "auto"> | null {
    return this.hysteresis.lastEffectiveMode;
  }

  /** Parse a message deterministically into a CanonicalIntent. Returns null if no match. */
  static parseDeterministic(message: string): CanonicalIntent | null {
    const m = message.toLowerCase().trim();
    for (const rule of KEYWORD_RULES) {
      const match = m.match(rule.test);
      if (match) {
        return {
          intent: rule.intent,
          target: rule.target ? rule.target(match) : undefined,
          confidence: 1.0,
          source: "deterministic",
        };
      }
    }
    return null;
  }
}
