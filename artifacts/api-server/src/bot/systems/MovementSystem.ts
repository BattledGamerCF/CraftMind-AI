import type { Bot } from "mineflayer";
import { logger } from "../../lib/logger.js";

interface Vec3Like { x: number; y: number; z: number }

export class MovementSystem {
  private bot: Bot;
  private pathfinder: unknown = null;
  private goals: unknown = null;
  private Movements: unknown = null;
  private active = false;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  async setup() {
    try {
      const pf = await import("mineflayer-pathfinder");
      this.pathfinder = pf.pathfinder;
      this.goals = pf.goals;
      this.Movements = pf.Movements;
      (this.bot as unknown as { loadPlugin: (p: unknown) => void }).loadPlugin(pf.pathfinder);
      logger.debug("Pathfinder loaded");
    } catch (err) {
      logger.warn({ err }, "mineflayer-pathfinder not available — movement limited");
    }
  }

  private get pfBot(): { pathfinder: { setMovements: (m: unknown) => void; setGoal: (g: unknown, dynamic?: boolean) => void; stop: () => void; isMoving: () => boolean } } | null {
    if (!this.pathfinder) return null;
    return this.bot as unknown as { pathfinder: { setMovements: (m: unknown) => void; setGoal: (g: unknown, dynamic?: boolean) => void; stop: () => void; isMoving: () => boolean } };
  }

  private getMovements() {
    if (!this.Movements || !this.pfBot) return null;
    const mcData = (this.bot as unknown as { registry: unknown }).registry;
    return new (this.Movements as new (bot: unknown, mcData: unknown) => unknown)(this.bot, mcData);
  }

  async goto(target: Vec3Like, range = 2): Promise<boolean> {
    const pfBot = this.pfBot;
    if (!pfBot || !this.goals) {
      logger.warn("Pathfinder not initialized");
      return false;
    }

    try {
      const movements = this.getMovements();
      if (movements) pfBot.pathfinder.setMovements(movements);

      const g = this.goals as Record<string, new (...args: unknown[]) => unknown>;
      const goal = new g["GoalNear"](target.x, target.y, target.z, range);
      pfBot.pathfinder.setGoal(goal);
      this.active = true;

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.stop();
          resolve();
        }, 30000);

        const botAny = this.bot as unknown as { once: (event: string, cb: () => void) => void; removeListener: (event: string, cb: () => void) => void };

        const onGoalReached = () => {
          clearTimeout(timeout);
          botAny.removeListener("path_update", onErr);
          resolve();
        };

        const onErr = () => {
          clearTimeout(timeout);
          botAny.removeListener("goal_reached", onGoalReached);
          resolve();
        };

        botAny.once("goal_reached", onGoalReached);
        botAny.once("path_update", onErr);
      });

      return true;
    } catch (err) {
      logger.debug({ err }, "goto error");
      return false;
    } finally {
      this.active = false;
    }
  }

  followPlayer(playerName: string) {
    const pfBot = this.pfBot;
    if (!pfBot || !this.goals) return;

    const player = this.bot.players[playerName];
    if (!player?.entity) return;

    try {
      const movements = this.getMovements();
      if (movements) pfBot.pathfinder.setMovements(movements);

      const g = this.goals as Record<string, new (...args: unknown[]) => unknown>;
      const goal = new g["GoalFollow"](player.entity, 3);
      pfBot.pathfinder.setGoal(goal, true);
      this.active = true;
    } catch (err) {
      logger.debug({ err }, "followPlayer error");
    }
  }

  stop() {
    try {
      const pfBot = this.pfBot;
      if (pfBot) pfBot.pathfinder.stop();
    } catch {
    }
    this.bot.clearControlStates();
    this.active = false;
  }

  isMoving(): boolean {
    const pfBot = this.pfBot;
    if (!pfBot) return false;
    try {
      return pfBot.pathfinder.isMoving();
    } catch {
      return false;
    }
  }

  async lookAt(target: Vec3Like, avert = false) {
    try {
      await this.bot.lookAt(target as Parameters<Bot["lookAt"]>[0], avert);
    } catch {
    }
  }

  distanceTo(target: Vec3Like): number {
    return this.bot.entity.position.distanceTo(target as Parameters<typeof this.bot.entity.position.distanceTo>[0]);
  }
}
