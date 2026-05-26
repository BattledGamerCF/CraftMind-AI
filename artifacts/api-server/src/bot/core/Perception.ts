import type { Bot } from "mineflayer";
import { logger } from "../../lib/logger.js";

export type EntityKind = "hostile" | "passive" | "player" | "item" | "other";

export interface PerceivedEntity {
  id: number;
  name: string;
  kind: EntityKind;
  position: { x: number; y: number; z: number };
  distance: number;
  health?: number;
}

export interface PerceivedHazard {
  kind: "lava" | "void" | "fire" | "fall";
  position: { x: number; y: number; z: number };
  distance: number;
}

export interface PerceptionSnapshot {
  timestamp: number;
  position: { x: number; y: number; z: number } | null;
  health: number;
  food: number;
  oxygen: number;
  entities: PerceivedEntity[];
  hostiles: PerceivedEntity[];
  players: PerceivedEntity[];
  passives: PerceivedEntity[];
  items: PerceivedEntity[];
  hazards: PerceivedHazard[];
  inventoryCount: Record<string, number>;
  timeOfDay: number;
  isRaining: boolean;
}

const HOSTILE_MOBS = new Set([
  "zombie", "skeleton", "creeper", "spider", "cave_spider",
  "enderman", "blaze", "witch", "phantom", "drowned",
  "husk", "stray", "wither_skeleton", "pillager", "vindicator",
  "evoker", "vex", "ravager", "hoglin", "piglin_brute",
  "zoglin", "warden", "breeze", "bogged", "zombified_piglin",
]);

const PASSIVE_MOBS = new Set([
  "cow", "pig", "sheep", "chicken", "rabbit", "horse",
  "wolf", "cat", "fox", "axolotl", "frog", "turtle",
  "villager", "iron_golem", "snow_golem",
]);

export class Perception {
  private bot: Bot;
  private snapshot: PerceptionSnapshot;
  private interval: NodeJS.Timeout | null = null;
  private listeners = new Set<(snap: PerceptionSnapshot) => void>();

  constructor(bot: Bot) {
    this.bot = bot;
    this.snapshot = this.makeEmptySnapshot();
  }

  start(intervalMs = 500) {
    if (this.interval) return;
    this.update();
    this.interval = setInterval(() => this.update(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  subscribe(listener: (snap: PerceptionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(): PerceptionSnapshot {
    return this.snapshot;
  }

  private update() {
    try {
      const entities: PerceivedEntity[] = [];
      const hostiles: PerceivedEntity[] = [];
      const players: PerceivedEntity[] = [];
      const passives: PerceivedEntity[] = [];
      const items: PerceivedEntity[] = [];

      const me = this.bot.entity?.position;
      if (!me) return;

      for (const e of Object.values(this.bot.entities)) {
        if (!e.position || e === this.bot.entity) continue;
        const dist = me.distanceTo(e.position);
        if (dist > 64) continue;

        const kind = this.classify(e.type, e.name);
        const perceived: PerceivedEntity = {
          id: (e as unknown as { id: number }).id,
          name: e.name ?? e.type,
          kind,
          position: { x: e.position.x, y: e.position.y, z: e.position.z },
          distance: dist,
          health: (e as unknown as { health?: number }).health,
        };

        entities.push(perceived);
        if (kind === "hostile") hostiles.push(perceived);
        else if (kind === "player") players.push(perceived);
        else if (kind === "passive") passives.push(perceived);
        else if (kind === "item") items.push(perceived);
      }

      hostiles.sort((a, b) => a.distance - b.distance);
      players.sort((a, b) => a.distance - b.distance);

      const hazards = this.scanHazards(me);
      const inventoryCount: Record<string, number> = {};
      for (const item of this.bot.inventory.items()) {
        inventoryCount[item.name] = (inventoryCount[item.name] ?? 0) + item.count;
      }

      this.snapshot = {
        timestamp: Date.now(),
        position: { x: me.x, y: me.y, z: me.z },
        health: this.bot.health ?? 0,
        food: this.bot.food ?? 0,
        oxygen: this.bot.oxygenLevel ?? 20,
        entities,
        hostiles,
        players,
        passives,
        items,
        hazards,
        inventoryCount,
        timeOfDay: this.bot.time?.timeOfDay ?? 0,
        isRaining: this.bot.isRaining ?? false,
      };

      for (const l of this.listeners) {
        try { l(this.snapshot); } catch (err) { logger.debug({ err }, "perception listener error"); }
      }
    } catch (err) {
      logger.debug({ err }, "Perception update error");
    }
  }

  private classify(type: string | undefined, name: string | undefined): EntityKind {
    if (type === "player") return "player";
    if (type === "object" || type === "orb" || name === "item") return "item";
    if (name && HOSTILE_MOBS.has(name)) return "hostile";
    if (name && PASSIVE_MOBS.has(name)) return "passive";
    return "other";
  }

  private scanHazards(me: { x: number; y: number; z: number; distanceTo: (p: { x: number; y: number; z: number }) => number }): PerceivedHazard[] {
    const hazards: PerceivedHazard[] = [];
    try {
      const radius = 4;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dy = -2; dy <= 1; dy++) {
            const pos = { x: Math.floor(me.x) + dx, y: Math.floor(me.y) + dy, z: Math.floor(me.z) + dz };
            const block = this.bot.blockAt(pos as Parameters<Bot["blockAt"]>[0]);
            if (!block) continue;
            if (block.name === "lava" || block.name === "flowing_lava") {
              hazards.push({ kind: "lava", position: pos, distance: me.distanceTo(pos) });
            } else if (block.name === "fire" || block.name === "soul_fire") {
              hazards.push({ kind: "fire", position: pos, distance: me.distanceTo(pos) });
            }
          }
        }
      }
    } catch {
    }
    hazards.sort((a, b) => a.distance - b.distance);
    return hazards.slice(0, 5);
  }

  private makeEmptySnapshot(): PerceptionSnapshot {
    return {
      timestamp: 0,
      position: null,
      health: 0,
      food: 0,
      oxygen: 0,
      entities: [],
      hostiles: [],
      players: [],
      passives: [],
      items: [],
      hazards: [],
      inventoryCount: {},
      timeOfDay: 0,
      isRaining: false,
    };
  }
}
