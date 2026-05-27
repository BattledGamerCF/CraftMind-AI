export type EpisodicEventKind =
  | "player_interaction"
  | "combat_encounter"
  | "resource_discovery"
  | "death"
  | "successful_build"
  | "task_failed"
  | "world_event";

export interface EpisodicEvent {
  id: number;
  kind: EpisodicEventKind;
  timestamp: number;
  description: string;
  position?: { x: number; y: number; z: number };
  participants?: string[];
  metadata?: Record<string, unknown>;
}

export interface EpisodicFilter {
  kind?: EpisodicEventKind;
  since?: number;
  participant?: string;
  limit?: number;
}

export class EpisodicMemory {
  private events: EpisodicEvent[] = [];
  private nextId = 1;
  private maxEvents = 500;

  record(event: Omit<EpisodicEvent, "id" | "timestamp">) {
    const full: EpisodicEvent = {
      id: this.nextId++,
      timestamp: Date.now(),
      ...event,
    };
    this.events.push(full);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    return full;
  }

  recall(filter: EpisodicFilter = {}): EpisodicEvent[] {
    let results = this.events;
    if (filter.kind) results = results.filter((e) => e.kind === filter.kind);
    if (filter.since !== undefined) {
      const since = filter.since;
      results = results.filter((e) => e.timestamp >= since);
    }
    if (filter.participant) {
      const p = filter.participant;
      results = results.filter((e) => e.participants?.includes(p));
    }
    results = [...results].reverse();
    if (filter.limit) results = results.slice(0, filter.limit);
    return results;
  }

  recent(limit = 10): EpisodicEvent[] {
    return this.events.slice(-limit).reverse();
  }

  clear() {
    this.events = [];
    this.nextId = 1;
  }

  count(): number {
    return this.events.length;
  }

  /** Count events of a specific kind within the given time window. */
  recentCount(kind: EpisodicEventKind, windowMs: number): number {
    const since = Date.now() - windowMs;
    return this.events.filter((e) => e.kind === kind && e.timestamp >= since).length;
  }

  /** True if any event of the given kind occurred within windowMs. */
  hasRecent(kind: EpisodicEventKind, windowMs: number): boolean {
    const since = Date.now() - windowMs;
    return this.events.some((e) => e.kind === kind && e.timestamp >= since);
  }
}
