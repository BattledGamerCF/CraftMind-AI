import type { Bot } from "mineflayer";
import { logger } from "../../lib/logger.js";

const FOOD_ITEMS = [
  "cooked_beef", "cooked_porkchop", "cooked_chicken", "cooked_mutton",
  "cooked_rabbit", "cooked_cod", "cooked_salmon", "bread",
  "baked_potato", "carrot", "apple", "golden_apple",
  "melon_slice", "pumpkin_pie", "cookie", "mushroom_stew",
  "rabbit_stew", "beetroot_soup",
];

export class HungerSystem {
  private bot: Bot;
  private enabled: boolean;
  private eating = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private hungerThreshold: number;

  constructor(bot: Bot, enabled = true, hungerThreshold = 16) {
    this.bot = bot;
    this.enabled = enabled;
    this.hungerThreshold = hungerThreshold;
  }

  /**
   * NOTE: The autonomous hunger-check loop is intentionally disabled in Phase 2.
   * Eating is now routed exclusively through the Arbitrator: Perception observes
   * food level and submits a CRITICAL `eat_food` task when food <= threshold.
   * This keeps all bot actions under central arbitration and prevents conflicts
   * with mining/building/combat tasks.
   *
   * start() remains a no-op for API compatibility; HungerSystem is used as a
   * pure action library (eat(), hasFood()) by the eat_food executor.
   */
  start() {
    // No-op — arbitrated via FastBrain's Perception → eat_food task pipeline.
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async checkHunger() {
    if (this.eating || !this.enabled) return;
    const food = this.bot.food;
    if (food <= this.hungerThreshold) {
      await this.eat();
    }
  }

  async eat(): Promise<boolean> {
    if (this.eating) return false;
    const foodItem = this.findFood();
    if (!foodItem) return false;

    this.eating = true;
    try {
      await this.bot.equip(foodItem, "hand");
      await this.bot.consume();
      logger.debug({ item: foodItem.name }, "Bot ate food");
      return true;
    } catch (err) {
      logger.debug({ err }, "Failed to eat");
      return false;
    } finally {
      this.eating = false;
    }
  }

  private findFood() {
    const items = this.bot.inventory.items();
    for (const foodName of FOOD_ITEMS) {
      const item = items.find((i) => i.name === foodName);
      if (item) return item;
    }
    return null;
  }

  hasFood(): boolean {
    return this.findFood() !== null;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop();
    else this.start();
  }
}
