import type { CognitiveMode } from "../types.js";

export interface CognitionEvent {
  effectiveMode: Exclude<CognitiveMode, "auto">;
  promptTokens: number;
  routingLatencyMs: number;
  confidence: number;
  source: "deterministic" | "llm" | "cache";
  deepReasoning: boolean;
}

export interface CognitionStats {
  totalRouted: number;
  modeFrequency: Record<string, number>;
  deterministicBypasses: number;
  deepReasoningActivations: number;
  cacheHits: number;
  cacheMisses: number;
  avgPromptTokens: number;
  avgRoutingLatencyMs: number;
  avgConfidence: number;
  confidenceDistribution: Record<string, number>;
}

/** 10 buckets: 0.0–0.1, 0.1–0.2, …, 0.9–1.0 */
const BUCKETS = 10;

export class CognitionTelemetry {
  private totalRouted = 0;
  private modeFrequency = new Map<string, number>();
  private deterministicBypasses = 0;
  private deepReasoningActivations = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private promptTokenSum = 0;
  private latencySum = 0;
  private confidenceSum = 0;
  private confidenceBuckets = new Array<number>(BUCKETS).fill(0);

  record(event: CognitionEvent): void {
    this.totalRouted++;
    this.modeFrequency.set(event.effectiveMode, (this.modeFrequency.get(event.effectiveMode) ?? 0) + 1);
    this.promptTokenSum += event.promptTokens;
    this.latencySum += event.routingLatencyMs;
    this.confidenceSum += event.confidence;

    if (event.source === "deterministic") this.deterministicBypasses++;
    if (event.source === "cache") this.cacheHits++;
    else this.cacheMisses++;
    if (event.deepReasoning) this.deepReasoningActivations++;

    const bucket = Math.min(Math.floor(event.confidence * BUCKETS), BUCKETS - 1);
    this.confidenceBuckets[bucket]++;
  }

  getStats(): CognitionStats {
    const n = this.totalRouted || 1;
    const dist: Record<string, number> = {};
    for (let i = 0; i < BUCKETS; i++) {
      dist[`${(i / BUCKETS).toFixed(1)}-${((i + 1) / BUCKETS).toFixed(1)}`] = this.confidenceBuckets[i] ?? 0;
    }
    return {
      totalRouted: this.totalRouted,
      modeFrequency: Object.fromEntries(this.modeFrequency),
      deterministicBypasses: this.deterministicBypasses,
      deepReasoningActivations: this.deepReasoningActivations,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      avgPromptTokens: Math.round(this.promptTokenSum / n),
      avgRoutingLatencyMs: Math.round(this.latencySum / n),
      avgConfidence: Math.round((this.confidenceSum / n) * 100) / 100,
      confidenceDistribution: dist,
    };
  }
}
