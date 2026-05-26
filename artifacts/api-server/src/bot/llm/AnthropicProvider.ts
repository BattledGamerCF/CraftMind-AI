import Anthropic from "@anthropic-ai/sdk";
import type { LLMMessage, LLMConfig } from "../types.js";
import type { LLMProvider } from "./LLMProvider.js";
import { logger } from "../../lib/logger.js";

export class AnthropicProvider implements LLMProvider {
  providerName = "anthropic";
  modelName: string;
  private client: Anthropic;
  private maxTokens: number;
  private temperature: number;

  constructor(config: LLMConfig) {
    this.modelName = config.model || "claude-3-haiku-20240307";
    this.maxTokens = config.maxTokens || 256;
    this.temperature = config.temperature ?? 0.7;
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env["ANTHROPIC_API_KEY"],
      baseURL: config.baseUrl,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async chat(messages: LLMMessage[], systemPrompt?: string): Promise<string> {
    const anthropicMessages: Anthropic.Messages.MessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    try {
      const response = await this.client.messages.create({
        model: this.modelName,
        max_tokens: this.maxTokens,
        system: systemPrompt,
        messages: anthropicMessages,
      });

      const block = response.content[0];
      if (block?.type === "text") return block.text.trim();
      return "";
    } catch (err) {
      logger.error({ err }, "Anthropic chat error");
      throw err;
    }
  }
}
