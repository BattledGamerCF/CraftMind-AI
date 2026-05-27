import { join } from "node:path";

const DATA_DIR =
  process.env["MINDCRAFT_DATA_DIR"] ??
  join(process.env["HOME"] ?? "/tmp", ".mindcraft");

export const config = {
  server: {
    nodeEnv: process.env["NODE_ENV"] ?? "development",
    logLevel: process.env["LOG_LEVEL"] ?? "info",
  },

  persistence: {
    dataDir: DATA_DIR,
    botsDir: join(DATA_DIR, "bots"),
    enabled: (process.env["MINDCRAFT_PERSISTENCE"] ?? "true") !== "false",
  },

  llm: {
    defaultProvider: "ollama" as const,
    defaultModel: "llama3.2",
    defaultOllamaBaseUrl:
      process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434",
    openaiApiKey: process.env["OPENAI_API_KEY"],
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
    requestTimeoutMs: Number(process.env["LLM_TIMEOUT_MS"] ?? "30000"),
  },

  bots: {
    maxConcurrent: Number(process.env["MINDCRAFT_MAX_BOTS"] ?? "10"),
    connectionTimeoutMs: 30_000,
    defaultChatCooldownMs: 3_000,
    defaultAutoEat: true,
    defaultDefendSelf: true,
    defaultHumanize: true,
    defaultCognitiveMode: "balanced" as const,
    defaultPlaystyle: "auto" as const,
  },

  safety: {
    maxWaypointsPerBot: 50,
    maxEpisodicEventsPerBot: 500,
    maxChatHistoryPerBot: 200,
    maxHabitIdleSpotsPerBot: 25,
    autonomousWanderMaxBlocks: 200,
    maxRetryLoops: 5,
  },
} as const;

export type AppConfig = typeof config;
