import type { Bot } from "mineflayer";
import type { BotState, LLMIntent } from "./types.js";
import { MovementSystem } from "./systems/MovementSystem.js";
import { CombatSystem } from "./systems/CombatSystem.js";
import { MiningSystem } from "./systems/MiningSystem.js";
import { BuildingSystem } from "./systems/BuildingSystem.js";
import { HungerSystem } from "./systems/HungerSystem.js";
import { HumanizationSystem } from "./systems/HumanizationSystem.js";
import { InventorySystem } from "./systems/InventorySystem.js";
import { SocialSystem } from "./systems/SocialSystem.js";
import { getStructure } from "./structures/StructureRegistry.js";
import { logger } from "../lib/logger.js";

export class FastBrain {
  private bot: Bot;
  state: BotState = "idle";
  private currentTask: string | null = null;
  private followTarget: string | null = null;

  movement: MovementSystem;
  combat: CombatSystem;
  mining: MiningSystem;
  building: BuildingSystem;
  hunger: HungerSystem;
  humanization: HumanizationSystem;
  inventory: InventorySystem;
  social: SocialSystem;

  constructor(bot: Bot, config: { humanize?: boolean; autoEat?: boolean; defendSelf?: boolean; chatCooldown?: number }) {
    this.bot = bot;
    this.humanization = new HumanizationSystem(bot, config.humanize ?? true);
    this.inventory = new InventorySystem(bot);
    this.movement = new MovementSystem(bot);
    this.combat = new CombatSystem(bot, this.humanization, this.inventory, config.defendSelf ?? true);
    this.mining = new MiningSystem(bot, this.humanization, this.inventory, this.movement);
    this.building = new BuildingSystem(bot, this.humanization, this.movement, this.inventory);
    this.hunger = new HungerSystem(bot, config.autoEat ?? true);
    this.social = new SocialSystem(bot, config.chatCooldown ?? 3000);
  }

  async setup(onChat: (username: string, message: string) => void) {
    await this.movement.setup();
    this.social.setup(onChat);
    this.combat.setup((newState) => {
      if (newState === "combat" || newState === "fleeing") {
        this.mining.stop();
        this.building.stop();
        this.movement.stop();
        this.followTarget = null;
        this.setState(newState as BotState);
      } else if (newState === "idle" && (this.state === "combat" || this.state === "fleeing")) {
        this.setState("idle");
      }
    });
    this.hunger.start();
    this.humanization.start();

    this.bot.on("death", () => {
      this.cancelCurrentTask();
      this.setState("idle");
      logger.debug("Bot died, returning to idle");
    });

    this.startIdleLoop();
  }

  private startIdleLoop() {
    setInterval(() => {
      if (this.state === "following" && this.followTarget) {
        const player = this.bot.players[this.followTarget];
        if (!player?.entity) return;
        const dist = this.movement.distanceTo(player.entity.position);
        if (dist > 16) {
          this.movement.followPlayer(this.followTarget);
        } else if (dist < 3) {
          this.movement.stop();
        }
      }
    }, 2000);
  }

  async executeIntent(intent: LLMIntent): Promise<void> {
    logger.debug({ intent }, "FastBrain executing intent");

    if (intent.chat) {
      await this.social.say(intent.chat);
    }

    switch (intent.intent) {
      case "stop":
        this.cancelCurrentTask();
        this.setState("idle");
        break;

      case "follow_player": {
        const target = intent.target ?? this.social.getClosestPlayer()?.name;
        if (!target) {
          await this.social.say("Who should I follow?");
          break;
        }
        this.cancelCurrentTask();
        this.followTarget = target;
        this.setState("following");
        this.movement.followPlayer(target);
        break;
      }

      case "come_here": {
        const playerName = intent.target ?? this.social.getClosestPlayer()?.name;
        if (!playerName) break;
        const player = this.bot.players[playerName];
        if (!player?.entity) break;
        this.cancelCurrentTask();
        this.setState("following");
        await this.movement.goto(player.entity.position, 3);
        this.setState("idle");
        break;
      }

      case "mine_resource": {
        const resource = intent.target ?? "wood";
        this.cancelCurrentTask();
        this.setState("mining");
        this.currentTask = `mining:${resource}`;
        this.mining.mine(resource, 32).then(() => {
          if (this.state === "mining") this.setState("idle");
          this.currentTask = null;
        }).catch(() => {
          this.setState("idle");
          this.currentTask = null;
        });
        break;
      }

      case "build_structure": {
        const structureName = intent.target ?? "simple_shelter";
        const structure = getStructure(structureName);
        if (!structure) {
          await this.social.say(`I don't know how to build that.`);
          break;
        }
        this.cancelCurrentTask();
        this.setState("building");
        this.currentTask = `building:${structureName}`;
        const origin = this.bot.entity.position.offset(3, 0, 3);
        this.building.build(structure, origin).then(() => {
          if (this.state === "building") this.setState("idle");
          this.currentTask = null;
        }).catch(() => {
          this.setState("idle");
          this.currentTask = null;
        });
        break;
      }

      case "explore":
        this.cancelCurrentTask();
        this.setState("exploring");
        this.doExplore().catch(() => {});
        break;

      case "gather_food":
        this.cancelCurrentTask();
        this.setState("mining");
        this.currentTask = "mining:food";
        this.mining.mine("food", 16).then(() => {
          if (this.state === "mining") this.setState("idle");
          this.currentTask = null;
        }).catch(() => {
          this.setState("idle");
          this.currentTask = null;
        });
        break;

      case "report_status":
        break;

      case "defend_self":
        this.cancelCurrentTask();
        break;

      case "idle":
      default:
        this.cancelCurrentTask();
        this.setState("idle");
        break;
    }
  }

  private async doExplore() {
    const pos = this.bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 30;
    const target = {
      x: pos.x + Math.cos(angle) * dist,
      y: pos.y,
      z: pos.z + Math.sin(angle) * dist,
    };
    await this.movement.goto(target, 3);
    if (this.state === "exploring") this.setState("idle");
  }

  private cancelCurrentTask() {
    this.mining.stop();
    this.building.stop();
    this.movement.stop();
    this.followTarget = null;
    this.currentTask = null;
  }

  private setState(state: BotState) {
    if (this.state !== state) {
      logger.debug({ from: this.state, to: state }, "State transition");
      this.state = state;
    }
  }

  getCurrentTask(): string | null {
    return this.currentTask ?? (this.followTarget ? `following:${this.followTarget}` : null);
  }

  teardown() {
    this.cancelCurrentTask();
    this.humanization.stop();
    this.hunger.stop();
  }
}
