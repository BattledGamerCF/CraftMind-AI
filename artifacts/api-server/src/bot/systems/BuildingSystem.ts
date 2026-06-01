import type { Bot } from "mineflayer";
import type { Structure, StructureBlock } from "../types.js";
import { logger } from "../../lib/logger.js";
import { HumanizationSystem } from "./HumanizationSystem.js";
import { MovementSystem } from "./MovementSystem.js";
import { InventorySystem } from "./InventorySystem.js";

interface Vec3Like { x: number; y: number; z: number }

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export class BuildingSystem {
  private bot: Bot;
  private humanization: HumanizationSystem;
  private movement: MovementSystem;
  private inventory: InventorySystem;
  private building = false;
  private stopRequested = false;

  constructor(
    bot: Bot,
    humanization: HumanizationSystem,
    movement: MovementSystem,
    inventory: InventorySystem
  ) {
    this.bot = bot;
    this.humanization = humanization;
    this.movement = movement;
    this.inventory = inventory;
  }

  async build(structure: Structure, origin: Vec3Like): Promise<void> {
    if (this.building) {
      logger.warn({ structure: structure.name }, "Build already in progress — ignoring duplicate request");
      return;
    }
    this.building = true;
    this.stopRequested = false;

    logger.info({ structure: structure.name, origin }, "Building started");

    const sortedBlocks = this.sortBlocksByBuildOrder(structure.blocks);
    let placed = 0;
    let skipped = 0;

    try {
      for (const sb of sortedBlocks) {
        if (this.stopRequested) {
          logger.info({ structure: structure.name, placed, skipped }, "Building stopped by request");
          break;
        }

        const pos = {
          x: Math.floor(origin.x) + sb.offset.x,
          y: Math.floor(origin.y) + sb.offset.y,
          z: Math.floor(origin.z) + sb.offset.z,
        };

        const ok = await this.placeBlock(sb.blockName, pos);
        if (ok) { placed++; } else { skipped++; }

        const delay = randomBetween(400, 900);
        await new Promise<void>((r) => setTimeout(r, delay));
      }

      logger.info({ structure: structure.name, placed, skipped }, "Building complete");
    } catch (err) {
      logger.error({ err, structure: structure.name, placed, skipped }, "Building failed with unexpected error");
      throw err;
    } finally {
      // Always reset building flag — prevents the system getting stuck if an error is thrown
      this.building = false;
    }
  }

  private sortBlocksByBuildOrder(blocks: StructureBlock[]): StructureBlock[] {
    return [...blocks].sort((a, b) => {
      if (a.offset.y !== b.offset.y) return a.offset.y - b.offset.y;
      return 0;
    });
  }

  private async placeBlock(blockName: string, pos: Vec3Like): Promise<boolean> {
    const existingBlock = this.bot.blockAt(pos as Parameters<Bot["blockAt"]>[0]);
    if (existingBlock && existingBlock.name !== "air" && existingBlock.name !== "cave_air") {
      return true;
    }

    const item = this.bot.inventory.items().find((i) => i.name === blockName);
    if (!item) {
      logger.debug({ blockName }, "Missing block in inventory");
      return false;
    }

    const dist = this.movement.distanceTo(pos);
    if (dist > 4) {
      await this.movement.goto({ x: pos.x, y: pos.y, z: pos.z }, 3);
    }

    try {
      await this.bot.equip(item, "hand");

      const referenceBlock = this.findReferenceBlock(pos);
      if (!referenceBlock) {
        logger.debug({ pos }, "No reference block found for placement");
        return false;
      }

      await this.humanization.impreciseLook(pos);
      await this.humanization.humanDelay(150, 350);
      await this.bot.placeBlock(referenceBlock, this.getFaceVector(pos, referenceBlock.position) as Parameters<Bot["placeBlock"]>[1]);
      return true;
    } catch (err) {
      logger.debug({ err, blockName, pos }, "Block placement failed");
      return false;
    }
  }

  private findReferenceBlock(targetPos: Vec3Like) {
    const offsets = [
      { x: 0, y: -1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 1, z: 0 },
    ];

    for (const off of offsets) {
      const checkPos = {
        x: targetPos.x + off.x,
        y: targetPos.y + off.y,
        z: targetPos.z + off.z,
      };
      const block = this.bot.blockAt(checkPos as Parameters<Bot["blockAt"]>[0]);
      if (block && block.name !== "air" && block.name !== "cave_air") {
        return block;
      }
    }
    return null;
  }

  private getFaceVector(targetPos: Vec3Like, referencePos: { x: number; y: number; z: number }) {
    const dx = targetPos.x - referencePos.x;
    const dy = targetPos.y - referencePos.y;
    const dz = targetPos.z - referencePos.z;

    if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) >= Math.abs(dz)) {
      return dy > 0 ? { x: 0, y: 1, z: 0 } : { x: 0, y: -1, z: 0 };
    }
    if (Math.abs(dx) >= Math.abs(dz)) {
      return dx > 0 ? { x: 1, y: 0, z: 0 } : { x: -1, y: 0, z: 0 };
    }
    return dz > 0 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 };
  }

  stop() {
    this.stopRequested = true;
    this.building = false;
  }

  isBuilding(): boolean {
    return this.building;
  }
}
