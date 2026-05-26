import type { Bot } from "mineflayer";
import { logger } from "../../lib/logger.js";

interface Vec3Like { x: number; y: number; z: number }

type PFBot = {
  pathfinder: {
    setMovements: (m: unknown) => void;
    setGoal: (g: unknown, dynamic?: boolean) => void;
    stop: () => void;
    isMoving: () => boolean;
  };
};

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

  private get pfBot(): PFBot | null {
    if (!this.pathfinder) return null;
    return this.bot as unknown as PFBot;
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
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          botAny.removeListener("goal_reached", onGoalReached);
          botAny.removeListener("path_update", onPathUpdate);
          resolve();
        };

        const timer = setTimeout(() => {
          this.stop();
          settle();
        }, 30_000);

        const botAny = this.bot as unknown as {
          once: (e: string, cb: (...args: unknown[]) => void) => void;
          on: (e: string, cb: (...args: unknown[]) => void) => void;
          removeListener: (e: string, cb: (...args: unknown[]) => void) => void;
        };

        const onGoalReached = () => settle();
        // Only resolve on genuine path failure, not normal updates
        const onPathUpdate = (result: unknown) => {
          const status = (result as { status?: string }).status ?? "";
          if (status === "noPath" || status === "timeout") settle();
        };

        botAny.once("goal_reached", onGoalReached);
        botAny.on("path_update", onPathUpdate);
      });

      return true;
    } catch (err) {
      logger.debug({ err }, "goto error");
      return false;
    } finally {
      this.active = false;
    }
  }

  /**
   * goto with stuck detection. Samples position every 3s; if bot hasn't moved
   * 0.4 blocks in 6s, attempts a jump-sprint recovery, then retries.
   */
  async gotoSafe(target: Vec3Like, range = 2, maxAttempts = 2): Promise<boolean> {
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      let lastX = this.bot.entity.position.x;
      let lastZ = this.bot.entity.position.z;
      let stuckMs = 0;
      let done = false;

      const stuckPoller = setInterval(() => {
        if (done) return;
        const pos = this.bot.entity.position;
        const moved = Math.abs(pos.x - lastX) + Math.abs(pos.z - lastZ);
        if (moved > 0.4) {
          lastX = pos.x;
          lastZ = pos.z;
          stuckMs = 0;
        } else {
          stuckMs += 3000;
          if (stuckMs >= 6000) {
            stuckMs = 0;
            this.recoverFromStuck().catch(() => {});
          }
        }
      }, 3000);

      const result = await this.goto(target, range);
      done = true;
      clearInterval(stuckPoller);

      if (result) return true;
      if (attempt < maxAttempts) await this.recoverFromStuck();
    }
    return false;
  }

  private async recoverFromStuck(): Promise<void> {
    logger.debug("MovementSystem: stuck recovery");
    try {
      this.bot.setControlState("jump", true);
      this.bot.setControlState("sprint", true);
      const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * 1.5;
      await this.bot.look(yaw, 0, false);
      await new Promise<void>((r) => setTimeout(r, 900));
    } finally {
      this.bot.clearControlStates();
    }
    await new Promise<void>((r) => setTimeout(r, 400));
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
