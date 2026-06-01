import { mkdir, access } from "node:fs/promises";
import app from "./app";
import { logger } from "./lib/logger";
import { config } from "./config";

// ── Global crash detection ──────────────────────────────────────────────────
process.on("uncaughtException", (err, origin) => {
  logger.fatal({ err, origin }, "Uncaught exception — process will exit");
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise: String(promise) }, "Unhandled promise rejection");
  // Do not exit — log and continue; individual tasks handle their own failures.
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  logger.error("PORT environment variable is required. Set PORT=8080 and retry.");
  process.exit(1);
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  logger.error({ rawPort }, "Invalid PORT value — must be a positive integer.");
  process.exit(1);
}

const server = app.listen(port, () => {
  const providers: string[] = ["ollama"];
  if (config.llm.openaiApiKey) providers.push("openai");
  if (config.llm.anthropicApiKey) providers.push("anthropic");

  logger.info(
    {
      port,
      env: config.server.nodeEnv,
      providers: providers.join(", "),
      maxBots: config.bots.maxConcurrent,
      dataDir: config.persistence.dataDir,
      persistence: config.persistence.enabled,
    },
    "Mindcraft API Server ready",
  );

  if (providers.length === 1) {
    logger.info(
      { ollamaUrl: config.llm.defaultOllamaBaseUrl },
      "No cloud API keys set — Ollama only. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to enable cloud providers.",
    );
  }

  if (config.debug.enabled) {
    logger.warn("MINDCRAFT_DEBUG=true — deterministic timers active, ambient behaviors suppressed");
  }

  // Async health checks — results logged but never block startup
  runHealthChecks().catch(() => {});
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(
      { port },
      `Port ${port} is already in use. Stop the other process or set API_PORT in .env to a different port.`,
    );
  } else {
    logger.error({ err }, "Failed to start server");
  }
  process.exit(1);
});

async function runHealthChecks() {
  // 1. Persistence directory
  try {
    await mkdir(config.persistence.botsDir, { recursive: true });
    await access(config.persistence.botsDir);
    logger.info({ path: config.persistence.botsDir }, "health: persistence ✓");
  } catch (err) {
    logger.warn({ err, path: config.persistence.botsDir },
      "health: persistence ✗ — bot state will not be saved. Check directory permissions or set MINDCRAFT_DATA_DIR.");
  }

  // 2. Ollama reachability (non-blocking, best-effort)
  const ollamaUrl = config.llm.defaultOllamaBaseUrl;
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      logger.info({ url: ollamaUrl }, "health: ollama ✓");
    } else {
      logger.info({ url: ollamaUrl, status: res.status }, "health: ollama reachable but returned error");
    }
  } catch {
    logger.info(
      { url: ollamaUrl },
      "health: ollama ✗ — not reachable. Start with `ollama serve` or configure a cloud provider instead.",
    );
  }
}
