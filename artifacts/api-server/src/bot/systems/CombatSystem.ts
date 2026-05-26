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

export class CombatSystem {
  private bot: Bot;
  private humanization: HumanizationSystem;
  private inventory: InventorySystem;
  private defending = false;
  private attackTarget: Entity | null = null;
  private attackInterval: NodeJS.Timeout | null = null;
  private enabled: boolean;
  private onStateChange: ((state: string) => void) | null = null;
  private fleeing = false;

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

  setup(onStateChange: (state: string) => void) {
    this.onStateChange = onStateChange;

    this.bot.on("entityHurt", (entity) => {
      if (entity === this.bot.entity && !this.defending && this.enabled) {
        this.handleAttacked().catch(() => {});
      }
    });

    this.bot.on("entityGone", (entity) => {
      if (entity === this.attackTarget) {
        this.stopAttacking();
        this.onStateChange?.("idle");
      }
    });

    setInterval(() => {
      if (this.enabled && !this.defending && !this.fleeing) {
        this.scanForHostiles().catch(() => {});
      }
    }, 2000);
  }

  private async scanForHostiles() {
    const hostile = this.findNearestHostile(8);
    if (hostile) {
      logger.debug({ mob: hostile.name }, "Hostile mob detected");
      await this.handleHostile(hostile);
    }
  }

  private findNearestHostile(range: number): Entity | null {
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

  private async handleAttacked() {
    await this.humanization.humanDelay(300, 800);
    const attacker = this.findNearestHostile(10);
    if (attacker) {
      await this.handleHostile(attacker);
    }
  }

  private async handleHostile(entity: Entity) {
    const dist = this.bot.entity.position.distanceTo(entity.position as unknown as Parameters<typeof this.bot.entity.position.distanceTo>[0]);
    const hp = this.bot.health;

    if (hp < 5) {
      await this.flee(entity);
      return;
    }

    await this.attackEntity(entity);
  }

  async attackEntity(entity: Entity): Promise<void> {
    if (this.defending) return;
    this.defending = true;
    this.attackTarget = entity;
    this.onStateChange?.("combat");

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
        this.onStateChange?.("idle");
        return;
      }

      try {
        await this.bot.lookAt(targetPos.offset(0, 1, 0), true);
        await this.humanization.humanDelay(50, 150);

        if (Math.random() > 0.1) {
          await this.bot.attack(this.attackTarget as unknown as Parameters<Bot["attack"]>[0]);
        }
      } catch {
        this.stopAttacking();
      }
    }, randomBetween(600, 900));
  }

  private async flee(entity: Entity) {
    if (this.fleeing) return;
    this.fleeing = true;
    this.stopAttacking();
    this.onStateChange?.("fleeing");

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
    this.bot.clearControlStates();
    this.fleeing = false;
    this.onStateChange?.("idle");
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
