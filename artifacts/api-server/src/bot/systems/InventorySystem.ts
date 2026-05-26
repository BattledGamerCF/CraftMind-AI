import type { Bot } from "mineflayer";
import type { InventoryItem } from "../types.js";
import { logger } from "../../lib/logger.js";

export class InventorySystem {
  private bot: Bot;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  getItems(): InventoryItem[] {
    return this.bot.inventory.items().map((item) => ({
      name: item.name,
      displayName: item.displayName,
      count: item.count,
      slot: item.slot,
    }));
  }

  countItem(name: string): number {
    return this.bot.inventory
      .items()
      .filter((i) => i.name === name)
      .reduce((sum, i) => sum + i.count, 0);
  }

  hasItem(name: string, count = 1): boolean {
    return this.countItem(name) >= count;
  }

  async equipBestTool(blockType: string): Promise<void> {
    const tools = this.bot.inventory.items().filter((i) =>
      i.name.includes("pickaxe") ||
      i.name.includes("axe") ||
      i.name.includes("shovel") ||
      i.name.includes("sword")
    );

    const toolPriority: Record<string, string[]> = {
      stone: ["diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "wooden_pickaxe", "golden_pickaxe"],
      wood: ["diamond_axe", "iron_axe", "stone_axe", "wooden_axe"],
      dirt: ["diamond_shovel", "iron_shovel", "stone_shovel", "wooden_shovel"],
      sand: ["diamond_shovel", "iron_shovel", "stone_shovel", "wooden_shovel"],
    };

    const preference = Object.entries(toolPriority).find(([k]) =>
      blockType.includes(k)
    );

    if (preference) {
      for (const toolName of preference[1]) {
        const tool = tools.find((t) => t.name === toolName);
        if (tool) {
          try {
            await this.bot.equip(tool, "hand");
            return;
          } catch {
            continue;
          }
        }
      }
    }
  }

  async equipBestWeapon(): Promise<void> {
    const weaponPriority = [
      "diamond_sword", "iron_sword", "stone_sword",
      "wooden_sword", "golden_sword",
      "diamond_axe", "iron_axe",
    ];
    const items = this.bot.inventory.items();
    for (const name of weaponPriority) {
      const weapon = items.find((i) => i.name === name);
      if (weapon) {
        try {
          await this.bot.equip(weapon, "hand");
          return;
        } catch {
          continue;
        }
      }
    }
  }

  async equipBestArmor(): Promise<void> {
    const armorSlots = [
      { slot: "head", priority: ["diamond_helmet", "iron_helmet", "chainmail_helmet", "gold_helmet", "leather_helmet"] },
      { slot: "torso", priority: ["diamond_chestplate", "iron_chestplate", "chainmail_chestplate", "gold_chestplate", "leather_chestplate"] },
      { slot: "legs", priority: ["diamond_leggings", "iron_leggings", "chainmail_leggings", "gold_leggings", "leather_leggings"] },
      { slot: "feet", priority: ["diamond_boots", "iron_boots", "chainmail_boots", "gold_boots", "leather_boots"] },
    ] as const;

    const items = this.bot.inventory.items();
    for (const { slot, priority } of armorSlots) {
      for (const name of priority) {
        const armor = items.find((i) => i.name === name);
        if (armor) {
          try {
            await this.bot.equip(armor, slot);
            break;
          } catch {
            continue;
          }
        }
      }
    }
  }

  /** True when the bot has 35+ item stacks — effectively full. */
  isFull(): boolean {
    return this.bot.inventory.items().length >= 35;
  }

  /**
   * Drop low-value trash items. Returns number of item types dropped.
   * Preserves tools, armor, food, and anything in KEEP_PATTERNS.
   */
  async tossTrash(): Promise<number> {
    const TRASH = new Set([
      "gravel", "flint", "rotten_flesh", "spider_eye", "bone",
      "gunpowder", "string", "ender_pearl", "slime_ball",
    ]);
    const KEEP_PATTERNS = [
      "pickaxe", "axe", "sword", "shovel", "hoe",
      "helmet", "chestplate", "leggings", "boots",
      "food", "bread", "beef", "pork", "mutton", "chicken", "fish",
      "apple", "carrot", "potato", "melon", "berry", "steak",
    ];

    let dropped = 0;
    for (const item of this.bot.inventory.items()) {
      if (TRASH.has(item.name)) {
        try { await this.bot.toss(item.type, null, item.count); dropped++; } catch {}
      } else if (KEEP_PATTERNS.every((p) => !item.name.includes(p))) {
        // Excess bulk items
        if (item.name === "cobblestone" && this.countItem("cobblestone") > 128) {
          const excess = this.countItem("cobblestone") - 128;
          try { await this.bot.toss(item.type, null, Math.min(excess, item.count)); dropped++; } catch {}
        } else if (item.name === "dirt" && this.countItem("dirt") > 32) {
          const excess = this.countItem("dirt") - 32;
          try { await this.bot.toss(item.type, null, Math.min(excess, item.count)); dropped++; } catch {}
        } else if (item.name === "sand" && this.countItem("sand") > 32) {
          const excess = this.countItem("sand") - 32;
          try { await this.bot.toss(item.type, null, Math.min(excess, item.count)); dropped++; } catch {}
        }
      }
    }
    return dropped;
  }

  async tossExcess(itemName: string, keepCount = 64): Promise<void> {
    const count = this.countItem(itemName);
    if (count > keepCount) {
      const tossCount = count - keepCount;
      const item = this.bot.inventory.items().find((i) => i.name === itemName);
      if (item) {
        try {
          await this.bot.toss(item.type, null, tossCount);
        } catch {
          logger.debug({ itemName, tossCount }, "Failed to toss excess items");
        }
      }
    }
  }
}
