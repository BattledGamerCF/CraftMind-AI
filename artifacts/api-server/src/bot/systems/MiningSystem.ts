import type { Bot } from "mineflayer";
type Block = { name: string; position: { x: number; y: number; z: number } };
import { logger } from "../../lib/logger.js";
import { HumanizationSystem } from "./HumanizationSystem.js";
import { InventorySystem } from "./InventorySystem.js";
import { MovementSystem } from "./MovementSystem.js";

const WOOD_BLOCKS = ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"];
const STONE_BLOCKS = ["stone", "cobblestone", "deepslate", "granite", "diorite", "andesite"];
const ORE_BLOCKS = ["coal_ore", "iron_ore", "gold_ore", "diamond_ore", "emerald_ore", "lapis_ore", "redstone_ore", "copper_ore", "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_gold_ore", "deepslate_diamond_ore"];

export const RESOURCE_TARGETS: Record<string, string[]> = {
  wood: WOOD_BLOCKS,
  stone: STONE_BLOCKS,
  ore: ORE_BLOCKS,
  coal: ["coal_ore", "deepslate_coal_ore"],
  iron: ["iron_ore", "deepslate_iron_ore"],
  diamond: ["diamond_ore", "deepslate_diamond_ore"],
  food: ["wheat", "carrots", "potatoes", "beetroots"],
};

export class MiningSystem {
  private bot: Bot;
  private humanization: HumanizationSystem;
  private inventory: InventorySystem;
  private movement: MovementSystem;
  private mining = false;
  private stopRequested = false;
  private currentTarget: string | null = null;

  constructor(
    bot: Bot,
    humanization: HumanizationSystem,
    inventory: InventorySystem,
    movement: MovementSystem
  ) {
    this.bot = bot;
    this.humanization = humanization;
    this.inventory = inventory;
    this.movement = movement;
  }

  async mine(resource: string, count = 32): Promise<void> {
    const blockNames = RESOURCE_TARGETS[resource] ?? [resource];
    this.mining = true;
    this.stopRequested = false;
    this.currentTarget = resource;
    let mined = 0;

    logger.debug({ resource, count }, "Mining started");

    while (mined < count && !this.stopRequested) {
      const block = this.findNearestBlock(blockNames, 32);
      if (!block) {
        logger.debug({ resource }, "No blocks found nearby");
        break;
      }

      const dist = this.movement.distanceTo(block.position);
      if (dist > 3) {
        const reached = await this.movement.goto(block.position, 2);
        if (!reached) continue;
      }

      try {
        await this.inventory.equipBestTool(block.name);
        await this.humanization.humanDelay(100, 300);
        await this.bot.dig(block as unknown as Parameters<Bot["dig"]>[0]);
        mined++;
        logger.debug({ block: block.name, mined, target: count }, "Block mined");
        await this.humanization.humanDelay(200, 500);
      } catch (err) {
        logger.debug({ err, block: block.name }, "Failed to mine block");
        await new Promise<void>((r) => setTimeout(r, 500));
      }
    }

    this.mining = false;
    this.currentTarget = null;
    logger.debug({ resource, mined }, "Mining finished");
  }

  private findNearestBlock(blockNames: string[], maxDistance: number): Block | null {
    let nearest: Block | null = null;
    let nearestDist = Infinity;

    for (const name of blockNames) {
      const mcData = (this.bot as unknown as { registry: { blocksByName: Record<string, { id: number }> } }).registry;
      const blockData = mcData.blocksByName[name];
      if (!blockData) continue;

      const block = this.bot.findBlock({
        matching: blockData.id,
        maxDistance,
        count: 1,
      });

      if (block) {
        const dist = this.movement.distanceTo(block.position);
        if (dist < nearestDist) {
          nearest = block;
          nearestDist = dist;
        }
      }
    }

    return nearest;
  }

  stop() {
    this.stopRequested = true;
    this.mining = false;
  }

  isMining(): boolean {
    return this.mining;
  }

  getCurrentTarget(): string | null {
    return this.currentTarget;
  }
}
