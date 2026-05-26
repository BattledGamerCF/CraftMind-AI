import OpenAI from "openai";
import type { LLMMessage, LLMConfig } from "../types.js";
import type { LLMProvider } from "./LLMProvider.js";
import { logger } from "../../lib/logger.js";

export class OpenAIProvider implements LLMProvider {
  providerName = "openai";
  modelName: string;
  private client: OpenAI;
  private maxTokens: number;
  private temperature: number;

  constructor(config: LLMConfig) {
    this.modelName = config.model || "gpt-4o-mini";
    this.maxTokens = config.maxTokens || 256;
    this.temperature = config.temperature ?? 0.7;
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env["OPENAI_API_KEY"],
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
    const allMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages: allMessages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });
      return completion.choices[0]?.message?.content?.trim() ?? "";
    } catch (err) {
      logger.error({ err }, "OpenAI chat error");
      throw err;
    }
  }
}
