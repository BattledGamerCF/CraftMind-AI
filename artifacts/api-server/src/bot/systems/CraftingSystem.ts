import type { Bot } from "mineflayer";
import { logger } from "../../lib/logger.js";

type AnyBot = Bot & Record<string, unknown>;

export class CraftingSystem {
  private bot: AnyBot;

  constructor(bot: Bot) {
    this.bot = bot as AnyBot;
  }

  private registry(): Record<string, Record<string, unknown>> {
    return ((this.bot["registry"] as unknown) as Record<string, Record<string, unknown>>) ?? {};
  }

  private getItemId(name: string): number | null {
    const reg = this.registry();
    const item = (reg["itemsByName"] as Record<string, { id: number }> | undefined)?.[name];
    return item?.id ?? null;
  }

  private findCraftingTable(): unknown {
    const reg = this.registry();
    const tableId = (reg["blocksByName"] as Record<string, { id: number }> | undefined)?.["crafting_table"]?.id;
    if (!tableId) return null;
    return (this.bot["findBlock"] as ((opts: unknown) => unknown) | undefined)?.({
      matching: tableId,
      maxDistance: 4,
    }) ?? null;
  }

  /** True if a recipe exists (with or without a table). */
  canCraft(itemName: string, useTable = false): boolean {
    const id = this.getItemId(itemName);
    if (!id) return false;
    const table = useTable ? this.findCraftingTable() : null;
    const recipeFn = this.bot["recipesFor"] as ((id: number, meta: null, min: number, table: unknown) => unknown[]) | undefined;
    return (recipeFn?.call(this.bot, id, null, 1, table) ?? []).length > 0;
  }

  /** Craft `count` of `itemName`. Tries without table first; falls back to nearby table. */
  async craftItem(itemName: string, count = 1): Promise<boolean> {
    const id = this.getItemId(itemName);
    if (!id) {
      logger.debug({ itemName }, "CraftingSystem: unknown item");
      return false;
    }

    const recipeFn = this.bot["recipesFor"] as ((id: number, meta: null, min: number, table: unknown) => unknown[]) | undefined;
    const craftFn = this.bot["craft"] as ((recipe: unknown, count: number, table: unknown) => Promise<void>) | undefined;
    if (!recipeFn || !craftFn) {
      logger.warn("CraftingSystem: craft API not available on this bot");
      return false;
    }

    // 1. Try 2×2 inventory grid (no table)
    let recipes = recipeFn.call(this.bot, id, null, 1, null);
    let table: unknown = null;

    // 2. Fall back to nearby crafting table for 3×3 recipes
    if (!recipes.length) {
      table = this.findCraftingTable();
      if (table) recipes = recipeFn.call(this.bot, id, null, 1, table);
    }

    if (!recipes.length) {
      logger.debug({ itemName }, "CraftingSystem: no recipe or missing table");
      return false;
    }

    try {
      await craftFn.call(this.bot, recipes[0], count, table);
      logger.debug({ itemName, count }, "CraftingSystem: crafted successfully");
      return true;
    } catch (err) {
      logger.debug({ err, itemName }, "CraftingSystem: craft failed");
      return false;
    }
  }

  /**
   * Craft planks from whatever logs are in inventory.
   * Returns the planks type crafted, or null.
   */
  async craftPlanks(count = 4): Promise<string | null> {
    const logTypes = [
      "oak_log", "birch_log", "spruce_log", "jungle_log",
      "acacia_log", "dark_oak_log", "mangrove_log",
    ];
    const items = (this.bot["inventory"] as { items: () => Array<{ name: string }> } | undefined)?.items() ?? [];
    const itemNames = new Set(items.map((i) => i.name));

    for (const log of logTypes) {
      if (!itemNames.has(log)) continue;
      const planks = log.replace("_log", "_planks");
      if (await this.craftItem(planks, count)) return planks;
    }
    return null;
  }

  /** Craft sticks from any planks in inventory. */
  async craftSticks(count = 4): Promise<boolean> {
    return this.craftItem("stick", count);
  }

  /** Craft torches if coal and sticks are available. */
  async craftTorches(count = 4): Promise<boolean> {
    return this.craftItem("torch", count);
  }
}
