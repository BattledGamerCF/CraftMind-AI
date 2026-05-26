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
import { getStructure } from "../structures/StructureRegistry.js";
import { logger } from "../../lib/logger.js";

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
        if (!target) return;
        deps.movement.followPlayer(target);
        await new Promise<void>((resolve) => {
          if (signal.aborted) { resolve(); return; }
          signal.addEventListener("abort", () => { deps.movement.stop(); resolve(); }, { once: true });
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

        const dist = night ? 10 + Math.random() * 10 : 20 + Math.random() * 40;
        const angle = Math.random() * Math.PI * 2;
        const target = {
          x: pos.x + Math.cos(angle) * dist,
          y: pos.y,
          z: pos.z + Math.sin(angle) * dist,
        };
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
        await new Promise<void>((resolve) => {
          if (signal.aborted) { resolve(); return; }
          const t = setTimeout(resolve, 5000);
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
