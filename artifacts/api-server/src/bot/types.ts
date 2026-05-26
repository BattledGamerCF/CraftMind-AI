export type LLMProviderType = "ollama" | "openai" | "anthropic";

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
    | "report_status";
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
