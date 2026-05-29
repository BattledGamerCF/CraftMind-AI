const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
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
  llm: { provider: string; model: string; baseUrl?: string };
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
};
