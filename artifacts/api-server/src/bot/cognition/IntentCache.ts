import type { CanonicalIntent } from "../types.js";

interface CacheEntry {
  intent: CanonicalIntent;
  cachedAt: number;
  ttlMs: number;
}

const MAX_ENTRIES = 200;
const TTL_DETERMINISTIC_MS = 120_000;
const TTL_LLM_MS = 30_000;
const MIN_CONFIDENCE_TO_CACHE = 0.75;

function normalizeKey(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class IntentCache {
  private cache = new Map<string, CacheEntry>();

  get(message: string): CanonicalIntent | null {
    const key = normalizeKey(message);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.intent;
  }

  set(message: string, intent: CanonicalIntent): void {
    if (intent.confidence < MIN_CONFIDENCE_TO_CACHE) return;
    const key = normalizeKey(message);
    const ttlMs = intent.source === "deterministic" ? TTL_DETERMINISTIC_MS : TTL_LLM_MS;

    if (this.cache.size >= MAX_ENTRIES) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }

    this.cache.set(key, { intent, cachedAt: Date.now(), ttlMs });
  }

  invalidate(message: string): void {
    this.cache.delete(normalizeKey(message));
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  /** Remove all expired entries — call occasionally to keep memory clean. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > entry.ttlMs) this.cache.delete(key);
    }
  }
}
