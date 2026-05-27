export type LLMProviderType = "ollama" | "openai" | "anthropic";

/**
 * Cognitive Economy Mode — controls how much LLM reasoning the bot applies.
 *
 * deterministic  No LLM. Chat is parsed locally via keyword matching.
 * lightweight    LLM called with compressed prompts and low max_tokens.
 * balanced       Default. Current behavior.
 * auto           Dynamically escalates based on context signals (health, complexity, urgency).
 * deep-reasoning Larger prompts, higher max_tokens — for planning-heavy or novel tasks.
 */
export type CognitiveMode = "deterministic" | "lightweight" | "balanced" | "auto" | "deep-reasoning";

export type BotState =
  | "idle"
  | "following"
  | "mining"
  | "building"
  | "combat"
  | "fleeing"
  | "eating"
  | "exploring"
  | "disconnected";

export interface BotConfig {
  host: string;
  port: number;
  username: string;
  version?: string;
  auth?: "offline" | "microsoft";
  llm: LLMConfig;
  behavior: BehaviorConfig;
  cognitiveMode?: CognitiveMode;
}

export interface LLMConfig {
  provider: LLMProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface BehaviorConfig {
  followDistance?: number;
  autoEat?: boolean;
  defendSelf?: boolean;
  humanize?: boolean;
  chatCooldown?: number;
  viewDistance?: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMIntent {
  intent:
    | "idle"
    | "follow_player"
    | "mine_resource"
    | "build_structure"
    | "explore"
    | "come_here"
    | "stop"
    | "gather_food"
    | "defend_self"
    | "report_status"
    | "return_home"
    | "set_home"
    | "cleanup_inventory"
    | "craft_tools";
  target?: string;
  chat?: string;
  params?: Record<string, unknown>;
}

export interface InventoryItem {
  name: string;
  displayName: string;
  count: number;
  slot: number;
}

export interface ChatMessage {
  timestamp: number;
  username: string;
  message: string;
  type: "chat" | "whisper" | "system";
}

export interface BotStatus {
  id: string;
  username: string;
  state: BotState;
  health: number;
  food: number;
  position: { x: number; y: number; z: number } | null;
  inventory: InventoryItem[];
  connected: boolean;
  server: string;
  chatHistory: ChatMessage[];
  currentTask: string | null;
  cognitiveMode: CognitiveMode;
}

export type PromptProfileKey =
  | "lightweight"
  | "balanced"
  | "combat"
  | "planning"
  | "social"
  | "builder"
  | "deep-reasoning";

export interface MemoryBudget {
  chatHistorySize: number;
  episodicEvents: number;
  semanticLocations: number;
  shortTermEntries: number;
}

export interface CognitiveDecision {
  selectedMode: CognitiveMode;
  effectiveMode: Exclude<CognitiveMode, "auto">;
  promptProfile: PromptProfileKey;
  tokenBudget: number;
  memoryBudget: MemoryBudget;
  deterministicAllowed: boolean;
  fallbackStrategy: "clarify" | "downgrade" | "ignore";
  reasoningDepth: "shallow" | "medium" | "deep";
}

export interface CanonicalIntent extends LLMIntent {
  confidence: number;
  source: "deterministic" | "llm" | "cache";
}

export interface CreateBotRequest {
  host: string;
  port?: number;
  username: string;
  version?: string;
  auth?: "offline" | "microsoft";
  llm: LLMConfig;
  behavior?: BehaviorConfig;
}

export interface CommandRequest {
  command: string;
  args?: Record<string, unknown>;
}

export interface StructureBlock {
  offset: { x: number; y: number; z: number };
  blockName: string;
  facing?: "north" | "south" | "east" | "west";
}

export interface Structure {
  name: string;
  displayName: string;
  blocks: StructureBlock[];
  width: number;
  height: number;
  depth: number;
}
