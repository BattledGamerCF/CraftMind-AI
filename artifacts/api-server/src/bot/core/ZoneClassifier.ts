import type { Bot } from "mineflayer";

export type ZoneType = "home" | "storage" | "workshop" | "mine" | "farm" | "danger" | "open";

const CACHE_TTL = 15_000;

/** Lightweight cached classifier — identifies the bot's current environmental zone. */
export class ZoneClassifier {
  private bot: Bot;
  private cached: ZoneType = "open";
  private expiry = 0;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  /** Classify the current zone; result is cached for 15 s to avoid expensive repeated scans. */
  classify(
    homePosition?: { x: number; y: number; z: number } | null,
    dangerWaypoints?: Array<{ x: number; y: number; z: number }>,
  ): ZoneType {
    const now = Date.now();
    if (now < this.expiry) return this.cached;
    this.cached = this.doClassify(homePosition, dangerWaypoints);
    this.expiry = now + CACHE_TTL;
    return this.cached;
  }

  /** Force invalidation (e.g. after teleport or home change). */
  invalidate() { this.expiry = 0; }

  getCached(): ZoneType { return this.cached; }

  private doClassify(
    homePosition?: { x: number; y: number; z: number } | null,
    dangerWaypoints?: Array<{ x: number; y: number; z: number }>,
  ): ZoneType {
    const pos = this.bot.entity.position;

    // 1. Home radius — highest priority for comfort behavior
    if (homePosition) {
      const dx = pos.x - homePosition.x, dy = pos.y - homePosition.y, dz = pos.z - homePosition.z;
      if (dx * dx + dy * dy + dz * dz < 18 * 18) return "home";
    }

    // 2. Near a known danger waypoint
    if (dangerWaypoints?.length) {
      for (const wp of dangerWaypoints) {
        const dx = pos.x - wp.x, dz = pos.z - wp.z;
        if (dx * dx + dz * dz < 12 * 12) return "danger";
      }
    }

    // 3. Block-presence heuristics (cheap findBlock scans)
    const fb = (pred: (name: string) => boolean, maxDist: number): boolean => {
      try {
        return !!this.bot.findBlock({
          matching: (b) => pred(b.name),
          maxDistance: maxDist,
        });
      } catch { return false; }
    };

    // Storage: chest density > 0 nearby
    if (fb((n) => n === "chest" || n === "trapped_chest" || n === "barrel" || n.endsWith("shulker_box"), 7)) {
      return "storage";
    }

    // Workshop: work surfaces nearby
    if (fb((n) =>
      n === "crafting_table" || n === "furnace" || n === "blast_furnace" ||
      n === "smoker" || n === "anvil" || n === "enchanting_table", 5)) {
      return "workshop";
    }

    // Farm: cultivated land/crops nearby
    if (fb((n) => n === "farmland" || n === "wheat" || n === "carrots" || n === "potatoes" || n === "beetroots", 9)) {
      return "farm";
    }

    // Mine: underground (y < 50 or y below ground surface)
    if (pos.y < 50) {
      // Confirm it's not just a deep valley — check skylight above
      try {
        const above = this.bot.blockAt(pos.offset(0, 10, 0));
        if (above && above.skyLight === 0) return "mine";
      } catch { /* chunk not loaded */ }
    }

    return "open";
  }
}
