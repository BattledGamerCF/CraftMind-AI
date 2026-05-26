import type { LLMConfig } from "../types.js";
import type { LLMProvider } from "./LLMProvider.js";
import { OllamaProvider } from "./OllamaProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import { AnthropicProvider } from "./AnthropicProvider.js";

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "ollama":
      return new OllamaProvider(config);
    case "openai":
      return new OpenAIProvider(config);
    case "anthropic":
      return new AnthropicProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
