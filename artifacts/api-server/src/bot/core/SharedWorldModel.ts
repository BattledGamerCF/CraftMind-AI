/**
 * Multi-agent groundwork.
 *
 * Today, each bot owns its own MemoryStore. The SharedWorldModel is a placeholder
 * interface for a future cross-bot shared memory layer (cooperative planning,
 * distributed task assignment, resource coordination, role specialization).
 *
 * The default in-process implementation simply broadcasts events to subscribed bots.
 * A future implementation can persist this to disk or distribute it over a network.
 */
import type { EpisodicEvent } from "../memory/EpisodicMemory.js";
import type { NamedLocation } from "../memory/SemanticMemory.js";

export type BotRole = "generalist" | "miner" | "builder" | "guard" | "scout" | "farmer";

export interface BotIdentity {
  id: string;
  username: string;
  role: BotRole;
}

export interface SharedEvent {
  sourceBotId: string;
  kind: "discovered_location" | "claimed_task" | "released_task" | "called_for_help" | "world_event";
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface SharedWorldModel {
  registerBot(identity: BotIdentity): void;
  unregisterBot(id: string): void;
  getBots(): BotIdentity[];
  getBotsByRole(role: BotRole): BotIdentity[];
  publish(event: SharedEvent): void;
  subscribe(listener: (event: SharedEvent) => void): () => void;
  shareLocation(loc: NamedLocation, fromBotId: string): void;
  shareEpisode(event: EpisodicEvent, fromBotId: string): void;
}

class InProcessSharedWorldModel implements SharedWorldModel {
  private bots = new Map<string, BotIdentity>();
  private listeners = new Set<(event: SharedEvent) => void>();

  registerBot(identity: BotIdentity) {
    this.bots.set(identity.id, identity);
  }

  unregisterBot(id: string) {
    this.bots.delete(id);
  }

  getBots(): BotIdentity[] {
    return Array.from(this.bots.values());
  }

  getBotsByRole(role: BotRole): BotIdentity[] {
    return this.getBots().filter((b) => b.role === role);
  }

  publish(event: SharedEvent) {
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore */ }
    }
  }

  subscribe(listener: (event: SharedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  shareLocation(loc: NamedLocation, fromBotId: string) {
    this.publish({
      sourceBotId: fromBotId,
      kind: "discovered_location",
      payload: { location: loc },
      timestamp: Date.now(),
    });
  }

  shareEpisode(event: EpisodicEvent, fromBotId: string) {
    this.publish({
      sourceBotId: fromBotId,
      kind: "world_event",
      payload: { event },
      timestamp: Date.now(),
    });
  }
}

export const sharedWorldModel: SharedWorldModel = new InProcessSharedWorldModel();
