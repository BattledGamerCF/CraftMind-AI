import type { Bot } from "mineflayer";
import type { OperationalState } from "../playstyle/PlaystyleProfile.js";
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
  private operationalState: OperationalState = "relaxed";
  private lastLookTime = 0;
  private lastPosition = { x: 0, y: 0, z: 0 };
  private lastPositionTime = 0;

  constructor(bot: Bot, enabled = true) {
    this.bot = bot;
    this.enabled = enabled;
  }

  setOperationalState(state: OperationalState) {
    this.operationalState = state;
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
    // Stressed/focused bots idle less often; curious bots idle more
    const multiplier = this.operationalState === "stressed" ? 3
      : this.operationalState === "focused" ? 2
      : this.operationalState === "curious" ? 0.7
      : 1;
    const delay = randomBetween(8000, 30000) * multiplier;
    this.idleTimer = setTimeout(() => {
      this.doIdleBehavior().catch(() => {});
      this.scheduleIdleBehavior();
    }, delay);
  }

  private scheduleLookAround() {
    // Stressed bots look around more often (anxious); focused bots rarely break gaze
    const multiplier = this.operationalState === "stressed" ? 0.5
      : this.operationalState === "focused" ? 2.5
      : 1;
    const delay = randomBetween(3000, 12000) * multiplier;
    this.lookTimer = setTimeout(() => {
      this.doLookAround().catch(() => {});
      this.scheduleLookAround();
    }, delay);
  }

  private async doIdleBehavior() {
    if (!this.enabled) return;
    // Suppress all idle motion during stressed or focused states
    if (this.operationalState === "stressed" || this.operationalState === "focused") return;

    const roll = Math.random();
    try {
      if (roll < 0.25) {
        await this.smallStep();
      } else if (roll < 0.35 && this.operationalState === "relaxed") {
        // Jump only when fully relaxed — not curious/focused/stressed
        await this.doJump();
      } else if (roll < 0.65) {
        await this.inspectNearbyBlock();
      }
    } catch {
    }
  }

  private async doLookAround() {
    if (!this.enabled) return;
    // Enforce minimum look cooldown to prevent look spam
    const now = Date.now();
    const minCooldown = this.operationalState === "focused" ? 8000 : 4000;
    if (now - this.lastLookTime < minCooldown) return;
    this.lastLookTime = now;
    try {
      const yaw = this.bot.entity.yaw + randomBetween(-0.8, 0.8);
      const pitch = randomBetween(-0.4, 0.3);
      await this.bot.look(yaw, pitch, false);
    } catch {
    }
  }

  /** Briefly glance toward a position (used for chat events, sounds, mob spawns). */
  async lookAtEvent(pos: { x: number; y: number; z: number }, opts: { jitter?: number; durationMs?: number } = {}) {
    if (!this.enabled) return;
    const jitter = opts.jitter ?? 0.3;
    try {
      const target = {
        x: pos.x + randomBetween(-jitter, jitter),
        y: pos.y + randomBetween(-jitter, jitter),
        z: pos.z + randomBetween(-jitter, jitter),
      };
      await this.bot.lookAt(target as Parameters<Bot["lookAt"]>[0], false);
      const hold = opts.durationMs ?? randomInt(400, 1200);
      await new Promise<void>((r) => setTimeout(r, hold));
    } catch {
    }
  }

  /** Pause briefly to "inspect" a random nearby block — believable idle curiosity. */
  async inspectNearbyBlock() {
    if (!this.enabled) return;
    try {
      const pos = this.bot.entity.position;
      const dx = randomInt(-4, 4);
      const dz = randomInt(-4, 4);
      const target = { x: Math.floor(pos.x) + dx, y: Math.floor(pos.y), z: Math.floor(pos.z) + dz };
      await this.bot.lookAt(target as Parameters<Bot["lookAt"]>[0], false);
      await new Promise<void>((r) => setTimeout(r, randomInt(500, 1500)));
    } catch {
    }
  }

  /** Small hesitation before committing to a movement — used by executors before goto. */
  async navigationHesitation() {
    if (!this.enabled) return;
    if (Math.random() < 0.35) {
      await new Promise<void>((r) => setTimeout(r, randomInt(150, 500)));
    }
  }

  /** Acknowledgement reaction — slight pause + head movement when responding to something. */
  async situationalReaction() {
    if (!this.enabled) return;
    await new Promise<void>((r) => setTimeout(r, randomInt(200, 600)));
    if (Math.random() < 0.5) {
      try {
        await this.bot.look(this.bot.entity.yaw + randomBetween(-0.3, 0.3), randomBetween(-0.2, 0.1), false);
      } catch {
      }
    }
  }

  private async smallStep() {
    const pos = this.bot.entity.position;
    const now = Date.now();

    // Anti-pacing: suppress small steps if we haven't moved meaningfully in 10s
    const elapsed = now - this.lastPositionTime;
    if (elapsed > 10_000) {
      const dx = pos.x - this.lastPosition.x;
      const dz = pos.z - this.lastPosition.z;
      const movedDist = Math.sqrt(dx * dx + dz * dz);
      this.lastPosition = { x: pos.x, y: pos.y, z: pos.z };
      this.lastPositionTime = now;
      if (movedDist < 2) return; // suppressed — bot is pacing in place
    } else if (this.lastPositionTime === 0) {
      this.lastPosition = { x: pos.x, y: pos.y, z: pos.z };
      this.lastPositionTime = now;
    }

    const dx = randomBetween(-0.5, 0.5);
    const dz = randomBetween(-0.5, 0.5);
    this.bot.setControlState("sneak", true);
    await this.bot.lookAt(
      { x: pos.x + dx, y: pos.y, z: pos.z + dz } as Parameters<Bot["lookAt"]>[0],
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
    try {
      await this.bot.lookAt(jittered as Parameters<Bot["lookAt"]>[0], false);
    } catch (err) {
      logger.debug({ err }, "impreciseLook failed");
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop();
    else this.start();
  }
}
