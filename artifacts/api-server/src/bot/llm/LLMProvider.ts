import type { LLMMessage } from "../types.js";

export interface LLMProvider {
  chat(messages: LLMMessage[], systemPrompt?: string): Promise<string>;
  isAvailable(): Promise<boolean>;
  providerName: string;
  modelName: string;
}
