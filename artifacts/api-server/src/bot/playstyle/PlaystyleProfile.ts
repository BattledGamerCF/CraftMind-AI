export type PlaystyleName = "companion" | "worker" | "adventurer" | "safe" | "auto";
export type OperationalState = "stressed" | "relaxed" | "focused" | "curious";

export interface PlaystyleWeights {
  followDistance: number;       // blocks to maintain when following
  explorationRange: number;     // multiplier on max explore distance (0.3–1.5)
  autonomyLevel: number;        // 0–1: tendency to self-initiate tasks
  riskTolerance: number;        // 0–1: scaling factor for risk decisions
  idleFrequency: number;        // 0–1: probability idle ambient behaviors fire
  socialFrequency: number;      // 0–1: chat/social response tendency
  taskPersistence: number;      // 0–1: retry aggression before giving up
  combatAggressiveness: number; // 0–1: engage vs flee weighting
  homeReturnBias: number;       // 0–1: tendency to return home when idle
  comfortRadius: number;        // blocks of personal space from players
}

const PROFILES: Record<Exclude<PlaystyleName, "auto">, PlaystyleWeights> = {
  companion: {
    followDistance: 3,
    explorationRange: 0.5,
    autonomyLevel: 0.3,
    riskTolerance: 0.4,
    idleFrequency: 0.7,
    socialFrequency: 0.8,
    taskPersistence: 0.5,
    combatAggressiveness: 0.4,
    homeReturnBias: 0.5,
    comfortRadius: 3,
  },
  worker: {
    followDistance: 8,
    explorationRange: 0.6,
    autonomyLevel: 0.85,
    riskTolerance: 0.5,
    idleFrequency: 0.15,
    socialFrequency: 0.2,
    taskPersistence: 0.9,
    combatAggressiveness: 0.5,
    homeReturnBias: 0.7,
    comfortRadius: 4,
  },
  adventurer: {
    followDistance: 10,
    explorationRange: 1.5,
    autonomyLevel: 0.75,
    riskTolerance: 0.7,
    idleFrequency: 0.5,
    socialFrequency: 0.4,
    taskPersistence: 0.6,
    combatAggressiveness: 0.65,
    homeReturnBias: 0.2,
    comfortRadius: 5,
  },
  safe: {
    followDistance: 4,
    explorationRange: 0.3,
    autonomyLevel: 0.2,
    riskTolerance: 0.1,
    idleFrequency: 0.35,
    socialFrequency: 0.5,
    taskPersistence: 0.7,
    combatAggressiveness: 0.1,
    homeReturnBias: 0.9,
    comfortRadius: 3,
  },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blendWeights(a: PlaystyleWeights, b: PlaystyleWeights, t: number): PlaystyleWeights {
  return {
    followDistance: lerp(a.followDistance, b.followDistance, t),
    explorationRange: lerp(a.explorationRange, b.explorationRange, t),
    autonomyLevel: lerp(a.autonomyLevel, b.autonomyLevel, t),
    riskTolerance: lerp(a.riskTolerance, b.riskTolerance, t),
    idleFrequency: lerp(a.idleFrequency, b.idleFrequency, t),
    socialFrequency: lerp(a.socialFrequency, b.socialFrequency, t),
    taskPersistence: lerp(a.taskPersistence, b.taskPersistence, t),
    combatAggressiveness: lerp(a.combatAggressiveness, b.combatAggressiveness, t),
    homeReturnBias: lerp(a.homeReturnBias, b.homeReturnBias, t),
    comfortRadius: lerp(a.comfortRadius, b.comfortRadius, t),
  };
}

export interface AutoBlendContext {
  riskScore: number;
  currentTaskType?: string;
  nearbyPlayerCount: number;
  isNight: boolean;
}

function resolveAuto(ctx: AutoBlendContext): PlaystyleWeights {
  let base = { ...PROFILES.worker };

  // High risk → blend toward safe
  if (ctx.riskScore > 0.4) {
    const t = Math.min((ctx.riskScore - 0.4) / 0.6, 1);
    base = blendWeights(base, PROFILES.safe, t);
  }

  // Players nearby → blend toward companion
  if (ctx.nearbyPlayerCount > 0) {
    const t = Math.min(ctx.nearbyPlayerCount / 3, 1) * 0.5;
    base = blendWeights(base, PROFILES.companion, t);
  }

  // Exploration task → blend toward adventurer tendency
  if (ctx.currentTaskType === "explore") {
    base = blendWeights(base, PROFILES.adventurer, 0.4);
  }

  // Night → bias toward safe
  if (ctx.isNight) {
    base = blendWeights(base, PROFILES.safe, 0.3);
  }

  return base;
}

export class PlaystyleProfile {
  private name: PlaystyleName;
  private _weights: PlaystyleWeights;

  constructor(name: PlaystyleName = "auto") {
    this.name = name;
    this._weights = name === "auto" ? { ...PROFILES.worker } : { ...PROFILES[name] };
  }

  getName(): PlaystyleName { return this.name; }

  setProfile(name: PlaystyleName) {
    this.name = name;
    if (name !== "auto") this._weights = { ...PROFILES[name] };
  }

  /** For "auto", resolve dynamically; for fixed profiles, return cached weights. */
  resolve(ctx?: AutoBlendContext): PlaystyleWeights {
    if (this.name === "auto" && ctx) {
      this._weights = resolveAuto(ctx);
    }
    return this._weights;
  }

  getWeights(): PlaystyleWeights { return this._weights; }

  snapshot() { return { name: this.name, weights: { ...this._weights } }; }
}

/** Derive the bot's operational mood from risk + task context. */
export function computeOperationalState(
  riskScore: number,
  currentTaskType?: string,
): OperationalState {
  if (riskScore >= 0.6) return "stressed";
  if (currentTaskType === "explore") return "curious";
  if (currentTaskType && currentTaskType !== "idle") return "focused";
  return "relaxed";
}
