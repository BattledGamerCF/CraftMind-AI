import type { Bot } from "mineflayer";
// Minimal Entity shape used internally; real prismarine-entity type is cast at call sites
type Entity = { type: string; name?: string; position: { x: number; y: number; z: number } };
import { logger } from "../../lib/logger.js";
import { HumanizationSystem } from "./HumanizationSystem.js";
import { InventorySystem } from "./InventorySystem.js";

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

const HOSTILE_MOBS = new Set([
  "zombie", "skeleton", "creeper", "spider", "cave_spider",
  "enderman", "blaze", "witch", "phantom", "drowned",
  "husk", "stray", "wither_skeleton", "pillager", "vindicator",
  "evoker", "vex", "ravager", "hoglin", "piglin_brute",
  "zoglin", "warden", "breeze",
]);

export type CombatThreatHandler = (entity: Entity, recommendedAction: "attack" | "flee") => void;

/**
 * CombatSystem is a pure action library now: attackEntity / flee / stopAttacking.
 * Threat *detection* lives in the Perception/FastBrain layer, which decides whether to
 * submit a CRITICAL/HIGH task to the Arbitrator. The only reactive behavior kept here
 * is the entityHurt event, which forwards to the onThreat callback so the Arbitrator
 * can preempt whatever is currently running.
 */
export class CombatSystem {
  private bot: Bot;
  private humanization: HumanizationSystem;
  private inventory: InventorySystem;
  private defending = false;
  private attackTarget: Entity | null = null;
  private attackInterval: NodeJS.Timeout | null = null;
  private enabled: boolean;
  private fleeing = false;
  private onThreat: CombatThreatHandler | null = null;

  constructor(
    bot: Bot,
    humanization: HumanizationSystem,
    inventory: InventorySystem,
    enabled = true
  ) {
    this.bot = bot;
    this.humanization = humanization;
    this.inventory = inventory;
    this.enabled = enabled;
  }

  setup(onThreat: CombatThreatHandler) {
    this.onThreat = onThreat;

    this.bot.on("entityHurt", (entity) => {
      if (entity === this.bot.entity && this.enabled && !this.defending) {
        const attacker = this.findNearestHostile(10);
        if (attacker) {
          const action: "attack" | "flee" = this.bot.health < 5 ? "flee" : "attack";
          this.onThreat?.(attacker, action);
        }
      }
    });

    this.bot.on("entityGone", (entity) => {
      if (entity === this.attackTarget) {
        this.stopAttacking();
      }
    });
  }

  findNearestHostile(range: number): Entity | null {
    let nearest: Entity | null = null;
    let nearestDist = Infinity;

    for (const entity of Object.values(this.bot.entities)) {
      if (entity.type !== "mob" || !entity.name) continue;
      if (!HOSTILE_MOBS.has(entity.name)) continue;
      const dist = this.bot.entity.position.distanceTo(entity.position as unknown as Parameters<typeof this.bot.entity.position.distanceTo>[0]);
      if (dist < range && dist < nearestDist) {
        nearest = entity as unknown as Entity;
        nearestDist = dist;
      }
    }

    return nearest;
  }

  async attackEntity(entity: Entity): Promise<void> {
    if (this.defending) return;
    this.defending = true;
    this.attackTarget = entity;

    await this.inventory.equipBestWeapon();

    this.attackInterval = setInterval(async () => {
      if (!this.attackTarget || !this.defending) {
        this.stopAttacking();
        return;
      }

      const targetPos = this.attackTarget.position as unknown as Parameters<typeof this.bot.entity.position.distanceTo>[0] & { offset: (x: number, y: number, z: number) => Parameters<Bot["lookAt"]>[0] };
      const dist = this.bot.entity.position.distanceTo(targetPos);
      if (dist > 4) {
        this.stopAttacking();
        return;
      }

      try {
        await this.bot.lookAt(targetPos.offset(0, 1, 0), true);
        await this.humanization.humanDelay(50, 150);

        // Occasional miss for human imperfection
        if (Math.random() > 0.1) {
          await this.bot.attack(this.attackTarget as unknown as Parameters<Bot["attack"]>[0]);
        }
      } catch {
        this.stopAttacking();
      }
    }, randomBetween(600, 900));
  }

  async flee(entity: Entity): Promise<void> {
    if (this.fleeing) return;
    this.fleeing = true;
    this.stopAttacking();

    try {
      const pos = this.bot.entity.position;
      const entityPos = entity.position;
      const dx = pos.x - entityPos.x;
      const dz = pos.z - entityPos.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;

      this.bot.setControlState("sprint", true);
      await this.bot.lookAt(
        { x: pos.x - dx / len * 5, y: pos.y, z: pos.z - dz / len * 5 } as Parameters<Bot["lookAt"]>[0],
        false
      );
      this.bot.setControlState("forward", true);

      await new Promise<void>((r) => setTimeout(r, 4000));
    } catch (err) {
      logger.debug({ err }, "flee error");
    } finally {
      this.bot.clearControlStates();
      this.fleeing = false;
    }
  }

  stopAttacking() {
    this.defending = false;
    this.attackTarget = null;
    if (this.attackInterval) {
      clearInterval(this.attackInterval);
      this.attackInterval = null;
    }
  }

  isDefending(): boolean {
    return this.defending || this.fleeing;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stopAttacking();
  }
}
