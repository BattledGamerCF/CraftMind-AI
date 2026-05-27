import type { LLMConfig } from "../types.js";
import type { LLMProvider } from "./LLMProvider.js";
import { OllamaProvider } from "./OllamaProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import { AnthropicProvider } from "./AnthropicProvider.js";

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "ollama":
      return new OllamaProvider(config);

    case "openai": {
      const key = config.apiKey ?? process.env["OPENAI_API_KEY"];
      if (!key) {
        throw new Error(
          "OpenAI provider requires an API key. " +
          "Set the OPENAI_API_KEY environment variable or pass apiKey in the bot config.",
        );
      }
      return new OpenAIProvider({ ...config, apiKey: key });
    }

    case "anthropic": {
      const key = config.apiKey ?? process.env["ANTHROPIC_API_KEY"];
      if (!key) {
        throw new Error(
          "Anthropic provider requires an API key. " +
          "Set the ANTHROPIC_API_KEY environment variable or pass apiKey in the bot config.",
        );
      }
      return new AnthropicProvider({ ...config, apiKey: key });
    }

    default: {
      const p = (config as { provider: string }).provider;
      throw new Error(
        `Unknown LLM provider: "${p}". Valid options: ollama, openai, anthropic.`,
      );
    }
  }
}
