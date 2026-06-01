import type { Bot } from "mineflayer";
import type { TaskExecutor } from "../core/Arbitrator.js";
import type { MovementSystem } from "../systems/MovementSystem.js";
import type { MiningSystem } from "../systems/MiningSystem.js";
import type { BuildingSystem } from "../systems/BuildingSystem.js";
import type { CombatSystem } from "../systems/CombatSystem.js";
import type { HungerSystem } from "../systems/HungerSystem.js";
import type { InventorySystem } from "../systems/InventorySystem.js";
import type { SocialSystem } from "../systems/SocialSystem.js";
import type { Perception } from "../core/Perception.js";
import type { CraftingSystem } from "../systems/CraftingSystem.js";
import type { PlaystyleWeights } from "../playstyle/PlaystyleProfile.js";
import type { HabitStore } from "../core/HabitStore.js";
import { getStructure } from "../structures/StructureRegistry.js";
import { logger } from "../../lib/logger.js";

// Explored-cell registry: prevents revisiting recently explored areas
const exploredCells = new Map<string, number>(); // cellKey → expireAt
const EXPLORE_CELL = 32; // blocks per grid cell
const EXPLORE_TTL_MS = 10 * 60_000;
function cellKey(x: number, z: number) {
  return `${Math.floor(x / EXPLORE_CELL)},${Math.floor(z / EXPLORE_CELL)}`;
}
function markExplored(x: number, z: number) {
  exploredCells.set(cellKey(x, z), Date.now() + EXPLORE_TTL_MS);
  const now = Date.now();
  for (const [k, exp] of exploredCells) if (now > exp) exploredCells.delete(k);
}
function isRecentlyExplored(x: number, z: number): boolean {
  const exp = exploredCells.get(cellKey(x, z));
  return !!exp && Date.now() < exp;
}

export interface ExecutorDeps {
  bot: Bot;
  movement: MovementSystem;
  mining: MiningSystem;
  building: BuildingSystem;
  combat: CombatSystem;
  hunger: HungerSystem;
  inventory: InventorySystem;
  social: SocialSystem;
  perception: Perception;
  crafting?: CraftingSystem;
  playstyle?: PlaystyleWeights;
  habits?: HabitStore;
  setHome?: (pos: { x: number; y: number; z: number }) => void;
  getHome?: () => { x: number; y: number; z: number } | null;
}

function whenAborted(signal: AbortSignal, cleanup: () => void): () => void {
  const handler = () => cleanup();
  signal.addEventListener("abort", handler, { once: true });
  return () => signal.removeEventListener("abort", handler);
}

/** Returns time-of-day (0–24000). >13000 = night. */
function timeOfDay(bot: Bot): number {
  return (bot as unknown as { time?: { timeOfDay?: number } }).time?.timeOfDay ?? 0;
}

function isNight(bot: Bot): boolean {
  const t = timeOfDay(bot);
  return t > 13000 && t < 23500;
}

export function createDefaultExecutors(deps: ExecutorDeps): TaskExecutor[] {
  return [
    {
      type: "mine_resource",
      async execute(task, signal) {
        // Skip if inventory is already full
        if (deps.inventory.isFull()) {
          logger.debug("mine_resource: inventory full, skipping");
          return;
        }

        const resource = task.target ?? "wood";
        const requestedCount = (task.metadata["count"] as number | undefined) ?? 32;

        // Reduce target count if we already have some
        const haveApprox = estimateResourceCount(deps, resource);
        if (haveApprox >= requestedCount) {
          logger.debug({ resource, haveApprox, requestedCount }, "mine_resource: already have enough");
          return;
        }
        const count = requestedCount - haveApprox;

        const detach = whenAborted(signal, () => deps.mining.stop());
        try {
          await deps.mining.mine(resource, count);
        } finally {
          detach();
        }
      },
    },
    {
      type: "build_structure",
      async execute(task, signal) {
        const structName = task.target ?? "simple_shelter";
        const structure = getStructure(structName);
        if (!structure) throw new Error(`unknown structure: ${structName}`);
        const origin = deps.bot.entity.position.offset(3, 0, 3);
        const detach = whenAborted(signal, () => deps.building.stop());
        try {
          await deps.building.build(structure, origin);
        } finally {
          detach();
        }
      },
    },
    {
      type: "follow_player",
      async execute(task, signal) {
        const target = task.target;
        if (!target) { logger.warn("follow_player: no target specified"); return; }

        const distance = deps.playstyle?.followDistance ?? 3;

        // Wait up to 30 s for the player entity to load (they may be in an unloaded chunk)
        const ENTITY_WAIT_MS = 30_000;
        const ENTITY_POLL_MS = 2_000;
        const entityWaitStart = Date.now();
        let followStarted = false;

        while (!signal.aborted) {
          const ok = deps.movement.followPlayer(target, distance);
          if (ok) { followStarted = true; break; }

          const elapsed = Date.now() - entityWaitStart;
          if (elapsed >= ENTITY_WAIT_MS) {
            logger.warn({ target, elapsedMs: elapsed }, "follow_player: player entity never became visible — aborting follow");
            return;
          }
          logger.debug({ target, elapsedMs: elapsed }, "follow_player: waiting for player entity to load...");
          await new Promise<void>((r) => setTimeout(r, ENTITY_POLL_MS));
        }

        if (!followStarted) return;

        // Re-apply goal every 5 s in case the entity reference becomes stale
        const REAPPLY_MS = 5_000;
        await new Promise<void>((resolve) => {
          if (signal.aborted) { resolve(); return; }
          const interval = setInterval(() => {
            if (signal.aborted) { clearInterval(interval); resolve(); return; }
            deps.movement.followPlayer(target, distance);
          }, REAPPLY_MS);
          signal.addEventListener("abort", () => {
            clearInterval(interval);
            deps.movement.stop();
            resolve();
          }, { once: true });
        });
      },
    },
    {
      type: "goto_position",
      async execute(task, signal) {
        const meta = task.metadata as { x?: number; y?: number; z?: number; range?: number };
        if (meta.x === undefined || meta.y === undefined || meta.z === undefined) {
          throw new Error("goto_position requires x/y/z metadata");
        }
        const detach = whenAborted(signal, () => deps.movement.stop());
        try {
          await deps.movement.gotoSafe({ x: meta.x, y: meta.y, z: meta.z }, meta.range ?? 2);
        } finally {
          detach();
        }
      },
    },
    {
      type: "goto_player",
      async execute(task, signal) {
        const target = task.target;
        if (!target) return;
        const player = deps.bot.players[target];
        if (!player?.entity) throw new Error(`player ${target} not visible`);
        const detach = whenAborted(signal, () => deps.movement.stop());
        try {
          await deps.movement.gotoSafe(player.entity.position, 3);
        } finally {
          detach();
        }
      },
    },
    {
      type: "explore",
      async execute(_task, signal) {
        // Skip if inventory is full — nothing to pick up anyway
        if (deps.inventory.isFull()) {
          logger.debug("explore: inventory full, skipping");
          return;
        }

        const pos = deps.bot.entity.position;
        const night = isNight(deps.bot);

        // At night: short radius, prefer toward home if known
        if (night) {
          const home = deps.getHome?.();
          if (home) {
            logger.debug("explore: night — returning home");
            const detach = whenAborted(signal, () => deps.movement.stop());
            try {
              await deps.movement.gotoSafe(home, 5);
            } finally {
              detach();
            }
            return;
          }
        }

        // Pick a direction, prefer cells not recently visited and not known-dangerous; scale by playstyle
        const rangeScale = deps.playstyle?.explorationRange ?? 1;
        const dist = (night ? 10 + Math.random() * 10 : 20 + Math.random() * 40) * rangeScale;
        let target = { x: pos.x, y: pos.y, z: pos.z };
        for (let attempt = 0; attempt < 8; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const candidate = {
            x: pos.x + Math.cos(angle) * dist,
            y: pos.y,
            z: pos.z + Math.sin(angle) * dist,
          };
          const recentlyExplored = isRecentlyExplored(candidate.x, candidate.z);
          const isDangerous = deps.habits?.isDangerousArea(candidate.x, candidate.z) ?? false;
          if (!recentlyExplored && !isDangerous) { target = candidate; break; }
          if (attempt === 7) target = candidate; // fallback: take last candidate regardless
        }

        markExplored(pos.x, pos.z);
        const detach = whenAborted(signal, () => deps.movement.stop());
        try {
          await deps.movement.gotoSafe(target, 3);
        } finally {
          detach();
        }
      },
    },
    {
      type: "engage_hostile",
      async execute(task, signal) {
        const entityId = task.metadata["entityId"] as number | undefined;
        if (entityId === undefined) throw new Error("engage_hostile requires entityId");
        const entity = deps.bot.entities[entityId];
        if (!entity) throw new Error("target entity gone");
        const detach = whenAborted(signal, () => deps.combat.stopAttacking());
        try {
          await deps.combat.attackEntity(entity as unknown as Parameters<typeof deps.combat.attackEntity>[0]);
          await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              if (signal.aborted || !deps.combat.isDefending()) {
                clearInterval(interval);
                resolve();
              }
            }, 250);
          });
        } finally {
          detach();
        }
      },
    },
    {
      type: "flee_threat",
      async execute(task, signal) {
        const entityId = task.metadata["entityId"] as number | undefined;
        if (entityId === undefined) throw new Error("flee_threat requires entityId");
        const entity = deps.bot.entities[entityId];
        if (!entity) return;
        const detach = whenAborted(signal, () => deps.movement.stop());
        try {
          const pos = deps.bot.entity.position;
          const dx = pos.x - entity.position.x;
          const dz = pos.z - entity.position.z;
          const len = Math.sqrt(dx * dx + dz * dz) || 1;
          await deps.movement.gotoSafe({
            x: pos.x + (dx / len) * 8,
            y: pos.y,
            z: pos.z + (dz / len) * 8,
          }, 2);
        } finally {
          detach();
        }
      },
    },
    {
      type: "eat_food",
      async execute() {
        await deps.hunger.eat();
      },
    },
    {
      type: "say",
      async execute(task) {
        const msg = task.metadata["message"] as string | undefined;
        if (msg) await deps.social.say(msg);
      },
    },
    {
      type: "idle",
      async execute(_task, signal) {
        if (signal.aborted) return;

        // Playstyle gate: low idleFrequency bots skip ambient behaviors
        if (Math.random() > (deps.playstyle?.idleFrequency ?? 0.6)) {
          await new Promise<void>((r) => setTimeout(r, 3000 + Math.random() * 2000));
          return;
        }

        // Habit: 30% chance to drift to a familiar idle spot when one is known nearby
        if (!signal.aborted && deps.habits && Math.random() < 0.3) {
          const pos = deps.bot.entity.position;
          const preferred = deps.habits.getPreferredIdleSpot(pos, 20);
          if (preferred && deps.movement.distanceTo(preferred) > 2) {
            const detach = whenAborted(signal, () => deps.movement.stop());
            try { await deps.movement.goto(preferred, 1); } catch { /* ok */ } finally { detach(); }
          }
        }

        // Subtle idle behaviors — pick one or two non-disruptive actions
        const behaviors: Array<() => Promise<void>> = [
          // Glance around
          async () => {
            const pos = deps.bot.entity.position;
            const yaw = Math.random() * Math.PI * 2;
            await deps.movement.lookAt({
              x: pos.x + Math.cos(yaw) * 6,
              y: pos.y + (Math.random() - 0.4) * 2,
              z: pos.z + Math.sin(yaw) * 6,
            });
          },
          // Tidy inventory if nearly full
          async () => {
            if (deps.inventory.isFull()) {
              await deps.inventory.tossTrash().catch(() => {});
            }
          },
          // Drift toward home if far away
          async () => {
            const home = deps.getHome?.();
            if (home && deps.movement.distanceTo(home) > 24) {
              const detach = whenAborted(signal, () => deps.movement.stop());
              try {
                await deps.movement.goto(home, 10);
              } finally {
                detach();
              }
            }
          },
        ];

        // Shuffle and run at most 2
        const chosen = behaviors.sort(() => Math.random() - 0.5).slice(0, 2);
        for (const b of chosen) {
          if (signal.aborted) return;
          await b().catch(() => {});
        }

        // Habit: record current idle position for future preference learning
        if (!signal.aborted && deps.habits) {
          deps.habits.recordIdlePosition(deps.bot.entity.position);
        }

        // Spatial etiquette: step off important blocks (crops, containers, work surfaces, beds)
        if (!signal.aborted) {
          try {
            const blockBelow = deps.bot.blockAt(deps.bot.entity.position.offset(0, -1, 0));
            if (blockBelow) {
              const n = blockBelow.name;
              const isImportant = n.endsWith("_bed") || n.includes("chest") || n === "barrel"
                || n === "crafting_table" || n === "furnace" || n === "blast_furnace"
                || n === "farmland" || n.endsWith("shulker_box") || n === "smoker";
              if (isImportant) {
                const pos = deps.bot.entity.position;
                const angle = Math.random() * Math.PI * 2;
                await deps.movement.goto(
                  { x: pos.x + Math.cos(angle) * 2, y: pos.y, z: pos.z + Math.sin(angle) * 2 }, 1
                ).catch(() => {});
              }
            }
          } catch { /* chunk not loaded or invalid pos */ }
        }

        // Natural pause
        await new Promise<void>((resolve) => {
          if (signal.aborted) { resolve(); return; }
          const t = setTimeout(resolve, 3000 + Math.random() * 2000);
          signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
      },
    },
    {
      type: "ensure_inventory",
      async execute(task, signal) {
        const requirements = task.metadata["requirements"] as Record<string, number> | undefined;
        if (!requirements) return;

        for (const [item, needed] of Object.entries(requirements)) {
          if (signal.aborted) return;
          if (deps.inventory.isFull()) {
            logger.debug("ensure_inventory: inventory full, stopping early");
            return;
          }
          const have = deps.inventory.countItem(item);
          if (have >= needed) continue;

          const resource = mapItemToResource(item);
          if (!resource) {
            logger.debug({ item }, "ensure_inventory: no resource mapping; skipping");
            continue;
          }

          const toMine = Math.min(needed - have, 32);
          logger.debug({ item, have, needed, resource, toMine }, "ensure_inventory: mining");
          try {
            await deps.mining.mine(resource, toMine);
          } catch (err) {
            logger.debug({ err, item }, "ensure_inventory: mining failed; continuing");
          }
        }
      },
    },
    {
      type: "equip_armor",
      async execute() {
        await deps.inventory.equipBestArmor();
      },
    },
    {
      type: "return_home",
      async execute(task, signal) {
        // Position can come from task metadata (planned) or home lookup
        const meta = task.metadata as { x?: number; y?: number; z?: number };
        const home = (meta.x !== undefined && meta.y !== undefined && meta.z !== undefined)
          ? { x: meta.x, y: meta.y, z: meta.z }
          : deps.getHome?.();

        if (!home) {
          logger.debug("return_home: no home known");
          await deps.social.say("I don't know where home is yet.").catch(() => {});
          return;
        }

        const detach = whenAborted(signal, () => deps.movement.stop());
        try {
          await deps.movement.gotoSafe(home, 4);
        } finally {
          detach();
        }
      },
    },
    {
      type: "set_home",
      async execute() {
        const pos = deps.bot.entity.position;
        deps.setHome?.({ x: pos.x, y: pos.y, z: pos.z });
        logger.info({ x: pos.x, y: pos.y, z: pos.z }, "Home base set");
        await deps.social.say("Home base set here.").catch(() => {});
      },
    },
    {
      type: "craft_item",
      async execute(task) {
        if (!deps.crafting) return;
        const item = task.target;
        if (!item) return;
        const count = (task.metadata["count"] as number | undefined) ?? 1;

        // Special helpers for common patterns
        if (item === "planks") {
          await deps.crafting.craftPlanks(count);
        } else if (item === "sticks") {
          await deps.crafting.craftSticks(count);
        } else if (item === "torches") {
          await deps.crafting.craftTorches(count);
        } else {
          await deps.crafting.craftItem(item, count);
        }
      },
    },
    {
      type: "cleanup_inventory",
      async execute() {
        const dropped = await deps.inventory.tossTrash();
        await deps.inventory.tossExcess("cobblestone", 128);
        await deps.inventory.tossExcess("dirt", 32);
        await deps.inventory.tossExcess("sand", 32);
        logger.debug({ dropped }, "cleanup_inventory: done");
      },
    },
  ];
}

/** Rough estimate of how many of a mineflayer resource type we already have. */
function estimateResourceCount(deps: ExecutorDeps, resource: string): number {
  const aliases: Record<string, string[]> = {
    wood: ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "oak_planks", "birch_planks"],
    stone: ["cobblestone", "stone", "cobbled_deepslate"],
    coal: ["coal"],
    iron: ["iron_ore", "raw_iron", "iron_ingot"],
    diamond: ["diamond", "diamond_ore"],
    dirt: ["dirt", "coarse_dirt"],
  };
  const names = aliases[resource] ?? [resource];
  return names.reduce((sum, n) => sum + deps.inventory.countItem(n), 0);
}

function mapItemToResource(item: string): string | null {
  if (item.includes("log")) return "wood";
  if (item.includes("planks")) return "wood";
  if (item.includes("cobblestone") || item === "stone") return "stone";
  if (item.includes("coal")) return "coal";
  if (item.includes("iron")) return "iron";
  if (item.includes("diamond")) return "diamond";
  if (item === "dirt") return "dirt";
  return null;
}
