import app from "./app";
import { logger } from "./lib/logger";
import { config } from "./config";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }

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
});
