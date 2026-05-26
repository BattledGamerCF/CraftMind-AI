import type { LLMMessage, LLMConfig } from "../types.js";
import type { LLMProvider } from "./LLMProvider.js";
import { logger } from "../../lib/logger.js";

export class OllamaProvider implements LLMProvider {
  providerName = "ollama";
  modelName: string;
  private baseUrl: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: LLMConfig) {
    this.modelName = config.model || "llama3.2";
    this.baseUrl = config.baseUrl || "http://localhost:11434";
    this.maxTokens = config.maxTokens || 256;
    this.temperature = config.temperature ?? 0.7;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<string> {
    const allMessages: LLMMessage[] = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          messages: allMessages,
          stream: false,
          options: {
            num_predict: this.maxTokens,
            temperature: this.temperature,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content?.trim() ?? "";
    } catch (err) {
      logger.error({ err }, "Ollama chat error");
      throw err;
    }
  }
}
