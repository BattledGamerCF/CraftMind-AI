const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      ...init,
    });
  } catch {
    throw new Error("Failed to fetch");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

export function friendlyError(err: unknown, _context: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("Load failed") ||
    msg.includes("502") ||
    msg.includes("503")
  ) {
    return "Cannot reach the API server. Is it running? Start it with Mindcraft.bat (Windows) or Mindcraft.sh (Linux/macOS).";
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("connect ECONNREFUSED")) {
    return "Bot couldn't connect to the Minecraft server. Check the host and port.";
  }
  if (
    msg.includes("Invalid protocol version") ||
    msg.includes("unsupported protocol") ||
    msg.includes("version mismatch")
  ) {
    return "Unsupported Minecraft version. Try a different version or use Auto-detect.";
  }
  if (
    msg.includes("API_KEY") ||
    msg.includes("Unauthorized") ||
    msg.includes("401") ||
    msg.includes("403")
  ) {
    return "LLM provider authentication failed. Check the API key environment variable on the server.";
  }
  if (msg.includes("OPENAI_API_KEY") || msg.includes("ANTHROPIC_API_KEY")) {
    return "Missing API key. Set the provider's key as an environment variable before starting the server.";
  }
  if (msg.includes("llm.provider") || msg.includes("llm.model")) {
    return "Provider and model are both required.";
  }
  if (msg.includes("host is required")) {
    return "Server host is required.";
  }
  if (msg.includes("Bot not found")) {
    return "Bot not found — it may have already disconnected.";
  }
  if (msg.includes("not supported") || msg.includes("not yet supported")) {
    return msg;
  }
  return msg;
}

export interface BotStatus {
  id: string;
  username: string;
  state: string;
  health: number;
  food: number;
  position: { x: number; y: number; z: number } | null;
  connected: boolean;
  server: string;
  currentTask: string | null;
  cognitiveMode: string;
  inventory: Array<{ name: string; displayName: string; count: number }>;
  chatHistory: Array<{
    timestamp: number;
    username: string;
    message: string;
    type: string;
  }>;
}

export interface RuntimeData {
  task: { current: { type: string; priority?: string } | null; queueLength: number };
  zone: string;
  operationalState: string;
  cognitiveMode: string;
  playstyle: { profile: string };
  riskScore: number;
  alertness: number;
  memory: {
    goal: string | null;
    threatCount: number;
    episodicEventCount: number;
    recentEvents: Array<{ kind: string; description: string; minsAgo: number }>;
    waypointCount: number;
  };
  telemetry: {
    totalTasks: number;
    successRate: number;
    failureRate: number;
    completedTasks: number;
    failedTasks: number;
  };
}

export interface MetaData {
  testedVersions: string[];
  latestTested: string;
  providers: string[];
  cognitiveModes: string[];
  playstyles: string[];
  note: string;
}

export interface CreateBotPayload {
  host: string;
  port: number;
  username: string;
  version?: string;
  auth: "offline" | "microsoft";
  llm: { provider: string; model: string; baseUrl?: string; apiKey?: string };
  behavior?: {
    humanize?: boolean;
    autoEat?: boolean;
    defendSelf?: boolean;
    chatCooldown?: number;
  };
  cognitiveMode?: string;
  playstyle?: string;
}

export const api = {
  listBots: () => apiFetch<{ bots: BotStatus[] }>("/bots").then((r) => r.bots),

  getRuntime: (id: string) => apiFetch<RuntimeData>(`/bots/${id}/runtime`),

  createBot: (payload: CreateBotPayload) =>
    apiFetch<{ bot: BotStatus }>("/bots", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((r) => r.bot),

  deleteBot: (id: string) =>
    apiFetch<{ success: boolean }>(`/bots/${id}`, { method: "DELETE" }),

  reconnectBot: (id: string) =>
    apiFetch<{ success: boolean }>(`/bots/${id}/reconnect`, { method: "POST" }),

  sendCommand: (
    id: string,
    command: string,
    args?: Record<string, unknown>,
  ) =>
    apiFetch<{ success: boolean }>(`/bots/${id}/command`, {
      method: "POST",
      body: JSON.stringify({ command, args }),
    }),

  getMeta: () => apiFetch<MetaData>("/meta"),

  getOllamaModels: (baseUrl?: string) => {
    const q = baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : "";
    return apiFetch<{ models: string[]; error?: string }>(`/ollama/models${q}`);
  },

  getLogs: (opts?: { level?: string; search?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.level && opts.level !== "all") params.set("level", opts.level);
    if (opts?.search) params.set("search", opts.search);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const q = params.toString() ? `?${params.toString()}` : "";
    return apiFetch<{ entries: LogEntry[] }>(`/logs${q}`);
  },
};

export interface LogEntry {
  level: string;
  time: number;
  msg: string;
  [key: string]: unknown;
}
