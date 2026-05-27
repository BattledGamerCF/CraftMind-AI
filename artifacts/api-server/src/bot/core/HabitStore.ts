/** Compact weighted-counter store for behavioral continuity across a session. */

const IDLE_GRID = 4;      // block grid cell size for idle-spot clustering
const MAX_IDLE_SPOTS = 25;
const MAX_PLAYERS = 20;
const MAX_DANGER_MARKS = 30;

interface WeightedPos { x: number; y: number; z: number; weight: number; lastSeen: number }
interface DangerMark { x: number; z: number; weight: number; expiry: number }
interface PlayerHabit { name: string; interactions: number; lastSeen: number }

export interface SerializedHabits {
  idleSpots: Array<{ k: string } & WeightedPos>;
  dangerMarks: DangerMark[];
  players: PlayerHabit[];
}

function idleKey(x: number, z: number): string {
  return `${Math.round(x / IDLE_GRID)}:${Math.round(z / IDLE_GRID)}`;
}

export class HabitStore {
  private idleSpots = new Map<string, WeightedPos>();
  private dangerMarks: DangerMark[] = [];
  private playerHabits = new Map<string, PlayerHabit>();

  // ── idle spot preference ──────────────────────────────────────────────────

  recordIdlePosition(pos: { x: number; y: number; z: number }): void {
    const key = idleKey(pos.x, pos.z);
    const existing = this.idleSpots.get(key);
    if (existing) {
      existing.weight += 1;
      existing.lastSeen = Date.now();
    } else {
      if (this.idleSpots.size >= MAX_IDLE_SPOTS) this.evictLeastUsedSpot();
      this.idleSpots.set(key, { x: pos.x, y: pos.y, z: pos.z, weight: 1, lastSeen: Date.now() });
    }
  }

  /**
   * Return a preferred idle spot near `near` within `maxDist` blocks.
   * Weighted-random: higher counts are more likely but not certain.
   * Returns null if no spot has weight > 2 (too early to have a preference).
   */
  getPreferredIdleSpot(near: { x: number; z: number }, maxDist = 20): WeightedPos | null {
    const candidates: WeightedPos[] = [];
    for (const spot of this.idleSpots.values()) {
      const dx = spot.x - near.x, dz = spot.z - near.z;
      if (dx * dx + dz * dz <= maxDist * maxDist && spot.weight > 2) candidates.push(spot);
    }
    if (!candidates.length) return null;
    const total = candidates.reduce((s, c) => s + c.weight, 0);
    let roll = Math.random() * total;
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) return c;
    }
    return candidates[candidates.length - 1]!;
  }

  // ── danger area tracking ──────────────────────────────────────────────────

  recordDangerArea(pos: { x: number; z: number }, durationMs = 90 * 60_000): void {
    const existing = this.dangerMarks.find(
      (d) => Math.abs(d.x - pos.x) < 16 && Math.abs(d.z - pos.z) < 16,
    );
    if (existing) {
      existing.weight = Math.min(existing.weight + 1, 5);
      existing.expiry = Date.now() + durationMs;
    } else {
      if (this.dangerMarks.length >= MAX_DANGER_MARKS) this.dangerMarks.shift();
      this.dangerMarks.push({ x: pos.x, z: pos.z, weight: 1, expiry: Date.now() + durationMs });
    }
  }

  isDangerousArea(x: number, z: number, radius = 24): boolean {
    const now = Date.now();
    return this.dangerMarks.some(
      (d) => d.expiry > now && Math.abs(d.x - x) < radius && Math.abs(d.z - z) < radius,
    );
  }

  // ── player familiarity ────────────────────────────────────────────────────

  recordPlayerInteraction(name: string): void {
    const existing = this.playerHabits.get(name);
    if (existing) {
      existing.interactions += 1;
      existing.lastSeen = Date.now();
    } else {
      if (this.playerHabits.size >= MAX_PLAYERS) this.evictOldestPlayer();
      this.playerHabits.set(name, { name, interactions: 1, lastSeen: Date.now() });
    }
  }

  /** Returns 0–1; saturates at 20 interactions. */
  getPlayerFamiliarity(name: string): number {
    const p = this.playerHabits.get(name);
    return p ? Math.min(1, p.interactions / 20) : 0;
  }

  // ── location familiarity (for HumanizationSystem confidence) ─────────────

  /**
   * 0–1: how much idle-time has been spent in this area.
   * Saturates when accumulated weight around the position reaches 10.
   */
  getLocationFamiliarity(pos: { x: number; z: number }, radius = 15): number {
    let total = 0;
    for (const spot of this.idleSpots.values()) {
      const dx = spot.x - pos.x, dz = spot.z - pos.z;
      if (dx * dx + dz * dz <= radius * radius) total += spot.weight;
    }
    return Math.min(1, total / 10);
  }

  // ── decay + pruning ───────────────────────────────────────────────────────

  /** Multiply all counters by `factor`; remove entries below threshold. Call every ~60 s. */
  decay(factor = 0.93): void {
    for (const [key, spot] of this.idleSpots) {
      spot.weight *= factor;
      if (spot.weight < 0.5) this.idleSpots.delete(key);
    }
    for (const [key, p] of this.playerHabits) {
      p.interactions *= factor;
      if (p.interactions < 0.3) this.playerHabits.delete(key);
    }
    const now = Date.now();
    this.dangerMarks = this.dangerMarks.filter((d) => d.expiry > now);
  }

  // ── persistence ───────────────────────────────────────────────────────────

  serialize(): SerializedHabits {
    return {
      idleSpots: [...this.idleSpots.entries()].map(([k, v]) => ({ k, ...v })),
      dangerMarks: [...this.dangerMarks],
      players: [...this.playerHabits.values()],
    };
  }

  restore(data: SerializedHabits): void {
    this.idleSpots.clear();
    for (const s of data.idleSpots ?? []) {
      this.idleSpots.set(s.k, { x: s.x, y: s.y, z: s.z, weight: s.weight, lastSeen: s.lastSeen });
    }
    this.dangerMarks = (data.dangerMarks ?? []).filter((d) => d.expiry > Date.now());
    this.playerHabits.clear();
    for (const p of data.players ?? []) {
      this.playerHabits.set(p.name, p);
    }
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private evictLeastUsedSpot(): void {
    let minKey = "", minW = Infinity;
    for (const [k, s] of this.idleSpots) {
      if (s.weight < minW) { minW = s.weight; minKey = k; }
    }
    if (minKey) this.idleSpots.delete(minKey);
  }

  private evictOldestPlayer(): void {
    let minKey = "", minT = Infinity;
    for (const [k, p] of this.playerHabits) {
      if (p.lastSeen < minT) { minT = p.lastSeen; minKey = k; }
    }
    if (minKey) this.playerHabits.delete(minKey);
  }
}
