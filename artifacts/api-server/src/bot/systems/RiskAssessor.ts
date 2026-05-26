import type { InventorySystem } from "./InventorySystem.js";

export interface RiskScore {
  /** 0.0 = safe, 1.0 = extremely dangerous */
  value: number;
  reasons: string[];
  /** True when the bot should abandon current task and flee/retreat */
  shouldRetreat: boolean;
  /** True when the bot should prefer fleeing over engaging */
  shouldAvoidCombat: boolean;
  /** True when the bot should stay near safe areas */
  shouldStayNear: boolean;
}

const HELMETS = [
  "leather_helmet", "chainmail_helmet", "golden_helmet",
  "iron_helmet", "diamond_helmet", "netherite_helmet",
];

export class RiskAssessor {
  assess(
    snap: { health: number; food: number; hostiles: unknown[] },
    inventory: InventorySystem,
    timeOfDay: number,
  ): RiskScore {
    let risk = 0;
    const reasons: string[] = [];

    // Health contribution
    if (snap.health <= 4) {
      risk += 0.45;
      reasons.push("critical health");
    } else if (snap.health <= 10) {
      risk += 0.22;
      reasons.push("low health");
    }

    // Food contribution
    if (snap.food <= 4) {
      risk += 0.15;
      reasons.push("starving");
    } else if (snap.food <= 8) {
      risk += 0.07;
      reasons.push("hungry");
    }

    // Hostile density
    const hc = snap.hostiles.length;
    if (hc >= 3) {
      risk += 0.35;
      reasons.push(`${hc} hostiles nearby`);
    } else if (hc >= 1) {
      risk += 0.15;
      reasons.push("hostile nearby");
    }

    // Night
    const isNight = timeOfDay > 13000 && timeOfDay < 23500;
    if (isNight) {
      risk += 0.15;
      reasons.push("night");
    }

    // Armor — helmet presence as a proxy for armor tier
    const hasArmor = HELMETS.some((h) => inventory.hasItem(h));
    if (!hasArmor) {
      risk += 0.10;
      reasons.push("no armor");
    }

    const value = Math.min(risk, 1.0);
    return {
      value,
      reasons,
      shouldRetreat: value >= 0.70,
      shouldAvoidCombat: value >= 0.50,
      shouldStayNear: isNight || snap.health <= 10,
    };
  }
}
