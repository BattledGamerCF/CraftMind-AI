import type { Bot } from "mineflayer";
import { logger } from "../../lib/logger.js";

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max));
}

export class HumanizationSystem {
  private bot: Bot;
  private idleTimer: NodeJS.Timeout | null = null;
  private lookTimer: NodeJS.Timeout | null = null;
  private enabled: boolean;

  constructor(bot: Bot, enabled = true) {
    this.bot = bot;
    this.enabled = enabled;
  }

  start() {
    if (!this.enabled) return;
    this.scheduleIdleBehavior();
    this.scheduleLookAround();
  }

  stop() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.lookTimer) { clearTimeout(this.lookTimer); this.lookTimer = null; }
  }

  private scheduleIdleBehavior() {
    const delay = randomBetween(8000, 30000);
    this.idleTimer = setTimeout(() => {
      this.doIdleBehavior().catch(() => {});
      this.scheduleIdleBehavior();
    }, delay);
  }

  private scheduleLookAround() {
    const delay = randomBetween(3000, 12000);
    this.lookTimer = setTimeout(() => {
      this.doLookAround().catch(() => {});
      this.scheduleLookAround();
    }, delay);
  }

  private async doIdleBehavior() {
    if (!this.enabled) return;
    const roll = Math.random();
    try {
      if (roll < 0.3) {
        await this.smallStep();
      } else if (roll < 0.5) {
        await this.doJump();
      }
    } catch {
    }
  }

  private async doLookAround() {
    if (!this.enabled) return;
    try {
      const yaw = this.bot.entity.yaw + randomBetween(-0.8, 0.8);
      const pitch = randomBetween(-0.4, 0.3);
      await this.bot.look(yaw, pitch, false);
    } catch {
    }
  }

  private async smallStep() {
    const { x, z } = this.bot.entity.position;
    const dx = randomBetween(-0.5, 0.5);
    const dz = randomBetween(-0.5, 0.5);
    this.bot.setControlState("sneak", true);
    await this.bot.lookAt(
      { x: x + dx, y: this.bot.entity.position.y, z: z + dz } as Parameters<Bot["lookAt"]>[0],
      false
    );
    await new Promise<void>((r) => setTimeout(r, randomInt(200, 500)));
    this.bot.setControlState("sneak", false);
  }

  private async doJump() {
    this.bot.setControlState("jump", true);
    await new Promise<void>((r) => setTimeout(r, 150));
    this.bot.setControlState("jump", false);
  }

  async humanDelay(minMs = 200, maxMs = 600): Promise<void> {
    if (!this.enabled) return;
    const delay = randomBetween(minMs, maxMs);
    await new Promise<void>((r) => setTimeout(r, delay));
  }

  async impreciseLook(targetPos: { x: number; y: number; z: number }) {
    const jitterX = randomBetween(-0.05, 0.05);
    const jitterY = randomBetween(-0.05, 0.05);
    const jittered = {
      x: targetPos.x + jitterX,
      y: targetPos.y + jitterY,
      z: targetPos.z,
    };
    await this.bot.lookAt(jittered as Parameters<Bot["lookAt"]>[0], false);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop();
    else this.start();
  }
}
