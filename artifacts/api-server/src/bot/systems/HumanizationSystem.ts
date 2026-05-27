import type { Bot } from "mineflayer";
import type { OperationalState } from "../playstyle/PlaystyleProfile.js";
import type { ZoneType } from "../core/ZoneClassifier.js";
import { config } from "../../config.js";
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
  private currentZone: ZoneType = "open";
  private alertness = 0; // 0–1: elevated alertness from recent world events
  private alertnessTimer: NodeJS.Timeout | null = null;
  private familiarityLevel = 0; // 0–1: how well-known this area is (fewer scans when high)
  private lastLookTime = 0;
  private lastPosition = { x: 0, y: 0, z: 0 };
  private lastPositionTime = 0;
  private lastEventReaction = 0; // rate-limit ambient event reactions

  constructor(bot: Bot, enabled = true) {
    this.bot = bot;
    this.enabled = enabled;
  }

  setOperationalState(state: OperationalState) {
    this.operationalState = state;
  }

  setZone(zone: ZoneType) {
    this.currentZone = zone;
  }

  /** Temporarily raise alertness (0–1) for durationMs. Alertness decays on timer expiry. */
  setAlertness(level: number, durationMs: number) {
    this.alertness = Math.min(1, Math.max(this.alertness, level));
    if (this.alertnessTimer) clearTimeout(this.alertnessTimer);
    this.alertnessTimer = setTimeout(() => {
      this.alertness = 0;
      this.alertnessTimer = null;
    }, durationMs);
  }

  getAlertness(): number { return this.alertness; }

  /** 0–1: familiar areas → less frequent scanning → more confident movement feel. */
  setFamiliarity(level: number) {
    this.familiarityLevel = Math.max(0, Math.min(1, level));
  }

  start() {
    if (!this.enabled) return;
    this.scheduleIdleBehavior();
    this.scheduleLookAround();
  }

  stop() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.lookTimer) { clearTimeout(this.lookTimer); this.lookTimer = null; }
    if (this.alertnessTimer) { clearTimeout(this.alertnessTimer); this.alertnessTimer = null; }
  }

  private scheduleIdleBehavior() {
    // Operational state multiplier
    const stateMult = this.operationalState === "stressed" ? 3
      : this.operationalState === "focused" ? 2
      : this.operationalState === "curious" ? 0.7
      : 1;
    // Zone multiplier: storage/workshop → less idle; home → slightly more; mine/danger → suppressed
    const zoneMult = this.currentZone === "storage" || this.currentZone === "workshop" ? 1.8
      : this.currentZone === "mine" || this.currentZone === "danger" ? 3
      : this.currentZone === "home" ? 0.8
      : 1;
    // Alertness suppresses idle
    const alertMult = this.alertness > 0.5 ? 2 : 1;
    const multiplier = stateMult * zoneMult * alertMult;
    // Debug mode: deterministic fixed delay (no variance) for reproducible behavior
    const delay = config.debug.enabled ? 15000 * multiplier : randomBetween(8000, 30000) * multiplier;
    this.idleTimer = setTimeout(() => {
      this.doIdleBehavior().catch(() => {});
      this.scheduleIdleBehavior();
    }, delay);
  }

  private scheduleLookAround() {
    // Stressed bots look around more often (anxious); focused bots rarely break gaze
    const stateMult = this.operationalState === "stressed" ? 0.5
      : this.operationalState === "focused" ? 2.5
      : 1;
    // Familiar areas → slower scan rate (confidence); unfamiliar → normal
    const famMult = this.familiarityLevel > 0.6 ? 1.5 : 1;
    const multiplier = stateMult * famMult;
    const delay = config.debug.enabled ? 8000 * multiplier : randomBetween(3000, 12000) * multiplier;
    this.lookTimer = setTimeout(() => {
      this.doLookAround().catch(() => {});
      this.scheduleLookAround();
    }, delay);
  }

  private async doIdleBehavior() {
    if (!this.enabled) return;
    // Debug mode: suppress all ambient noise for reproducible behavior
    if (config.debug.enabled) return;
    // Suppress during stressed/focused state or high alertness
    if (this.operationalState === "stressed" || this.operationalState === "focused") return;
    if (this.alertness > 0.7) return;
    // Suppress movement in storage/workshop zones (avoid blocking containers)
    const suppressMotion = this.currentZone === "storage" || this.currentZone === "workshop";

    const roll = Math.random();
    try {
      if (!suppressMotion && roll < 0.25) {
        await this.smallStep();
      } else if (!suppressMotion && roll < 0.35 && this.operationalState === "relaxed") {
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
    // Alert bots scan more frequently (anxious); focused bots rarely look away
    const minCooldown = this.operationalState === "focused" ? 8000
      : this.alertness > 0.5 ? 1500
      : 4000;
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
