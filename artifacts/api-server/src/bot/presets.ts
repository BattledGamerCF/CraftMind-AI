/**
 * Bot config presets — ready-to-use behavioral profiles.
 *
 * Usage: spread into a POST /api/bots body, then override host/port/username:
 *   { ...presets.minimal_companion, host: "localhost", port: 25565, username: "MindBot" }
 *
 * // EXTENSION POINT: add new presets here; no code changes needed elsewhere.
 */

interface BotPreset {
  auth: "offline" | "microsoft";
  llm: {
    provider: "ollama" | "openai" | "anthropic";
    model: string;
    baseUrl?: string;
  };
  behavior: {
    humanize: boolean;
    autoEat: boolean;
    defendSelf: boolean;
    chatCooldown: number;
  };
  cognitiveMode: "lightweight" | "balanced" | "deep-reasoning";
  playstyle: "companion" | "worker" | "adventurer" | "safe" | "auto";
}

/** Low autonomy. Follows player, responds to chat, avoids combat. */
export const minimal_companion: BotPreset = {
  auth: "offline",
  llm: { provider: "ollama", model: "llama3.2", baseUrl: "http://localhost:11434" },
  behavior: { humanize: true, autoEat: true, defendSelf: false, chatCooldown: 3000 },
  cognitiveMode: "lightweight",
  playstyle: "companion",
};

/** Task-focused. Mines and builds on command. Minimal social noise. */
export const stable_worker: BotPreset = {
  auth: "offline",
  llm: { provider: "ollama", model: "llama3.2", baseUrl: "http://localhost:11434" },
  behavior: { humanize: false, autoEat: true, defendSelf: true, chatCooldown: 5000 },
  cognitiveMode: "balanced",
  playstyle: "worker",
};

/** Highest safety. Never initiates combat. Stays near player or home zone. */
export const safe_observer: BotPreset = {
  auth: "offline",
  llm: { provider: "ollama", model: "llama3.2", baseUrl: "http://localhost:11434" },
  behavior: { humanize: true, autoEat: true, defendSelf: false, chatCooldown: 4000 },
  cognitiveMode: "lightweight",
  playstyle: "safe",
};

/** Moderate autonomy. Explores and gathers. Bounded wander radius. */
export const explorer_light: BotPreset = {
  auth: "offline",
  llm: { provider: "ollama", model: "llama3.2", baseUrl: "http://localhost:11434" },
  behavior: { humanize: true, autoEat: true, defendSelf: true, chatCooldown: 3000 },
  cognitiveMode: "balanced",
  playstyle: "adventurer",
};

export const presets = { minimal_companion, stable_worker, safe_observer, explorer_light } as const;
export type PresetName = keyof typeof presets;
