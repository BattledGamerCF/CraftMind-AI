import { randomUUID } from "node:crypto";
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
import { Arbitrator } from "./core/Arbitrator.js";
import { Planner, type PlanContext } from "./core/Planner.js";
import { Perception } from "./core/Perception.js";
import { Telemetry } from "./core/Telemetry.js";
import { MemoryStore } from "./memory/index.js";
import { createTask } from "./core/Task.js";
import type { Task } from "./core/Task.js";
import { registerDefaultPlans } from "./plans/index.js";
import { createDefaultExecutors } from "./executors/index.js";
import { logger } from "../lib/logger.js";

export interface FastBrainConfig {
  humanize?: boolean;
  autoEat?: boolean;
  defendSelf?: boolean;
  chatCooldown?: number;
}

/**
 * FastBrain is the deterministic gameplay container.
 *
 * It hosts:
 *  - Gameplay Systems (movement, combat, mining, building, hunger, inventory, social, humanization)
 *  - Perception — unified read layer that all systems may consume
 *  - Arbitrator — priority task queue with preemption (CRITICAL/HIGH/NORMAL/LOW)
 *  - Planner — turns LLM intents into Task[] (hierarchical plans w/ prerequisites)
 *  - MemoryStore — short-term / episodic / semantic
 *  - Telemetry — per-task records, failure summaries, success rates
 *
 * The flow is: LLMIntent → Planner.plan(intent) → Tasks → Arbitrator.enqueue → Executors.
 * Reactive systems (combat, hazards) submit CRITICAL tasks directly to the Arbitrator,
 * preempting whatever is currently running.
 */
export class FastBrain {
  private bot: Bot;

  movement: MovementSystem;
  combat: CombatSystem;
  mining: MiningSystem;
  building: BuildingSystem;
  hunger: HungerSystem;
  humanization: HumanizationSystem;
  inventory: InventorySystem;
  social: SocialSystem;

  perception: Perception;
  arbitrator: Arbitrator;
  planner: Planner;
  memory: MemoryStore;
  telemetry: Telemetry;

  private threatWatcherStop: (() => void) | null = null;
  private hazardWatcherStop: (() => void) | null = null;
  private pruneInterval: NodeJS.Timeout | null = null;

  constructor(bot: Bot, config: FastBrainConfig) {
    this.bot = bot;
    this.humanization = new HumanizationSystem(bot, config.humanize ?? true);
    this.inventory = new InventorySystem(bot);
    this.movement = new MovementSystem(bot);
    this.combat = new CombatSystem(bot, this.humanization, this.inventory, config.defendSelf ?? true);
    this.mining = new MiningSystem(bot, this.humanization, this.inventory, this.movement);
    this.building = new BuildingSystem(bot, this.humanization, this.movement, this.inventory);
    this.hunger = new HungerSystem(bot, config.autoEat ?? true);
    this.social = new SocialSystem(bot, config.chatCooldown ?? 3000);

    this.perception = new Perception(bot);
    this.memory = new MemoryStore();
    this.telemetry = new Telemetry();
    this.arbitrator = new Arbitrator();
    this.arbitrator.setTelemetry(this.telemetry);
    this.planner = new Planner();
  }

  async setup(onChat: (username: string, message: string) => void) {
    await this.movement.setup();

    // Register plan builders and executors
    registerDefaultPlans(this.planner);
    const executors = createDefaultExecutors({
      bot: this.bot,
      movement: this.movement,
      mining: this.mining,
      building: this.building,
      combat: this.combat,
      hunger: this.hunger,
      inventory: this.inventory,
      social: this.social,
      perception: this.perception,
      setHome: (pos) => this.memory.semantic.setHome(pos),
      getHome: () => this.memory.semantic.getHome()?.position ?? null,
    });
    for (const e of executors) this.arbitrator.registerExecutor(e);

    // Wire arbitrator → episodic memory & short-term failure tracking
    this.arbitrator.setOnTaskComplete((task) => this.onTaskComplete(task));

    // Chat: humanized situational reaction + store + forward
    this.social.setup((username, message) => {
      this.memory.shortTerm.pushChat({ timestamp: Date.now(), username, message, type: "chat" });
      this.humanization.situationalReaction().catch(() => {});
      const player = this.bot.players[username];
      if (player?.entity) {
        this.humanization.lookAtEvent(player.entity.position).catch(() => {});
      }
      onChat(username, message);
    });

    // Combat: reactive entityHurt event submits CRITICAL task to arbitrator
    this.combat.setup((entity, action) => {
      this.submitCombatTask(entity, action);
    });

    this.hunger.start();
    this.humanization.start();
    this.perception.start(500);

    // Threat watcher — submits CRITICAL combat tasks when hostiles approach
    this.threatWatcherStop = this.perception.subscribe((snap) => {
      this.memory.shortTerm.setThreats(snap.hostiles.map((h) => ({
        name: h.name, distance: h.distance, position: h.position,
      })));

      const current = this.arbitrator.getCurrent();
      const alreadyEngaging = current?.type === "engage_hostile" || current?.type === "flee_threat";

      // Hostile within 8 blocks → engage or flee
      const closest = snap.hostiles[0];
      if (closest && closest.distance < 8 && !alreadyEngaging) {
        const entity = this.bot.entities[closest.id];
        if (entity) {
          const action: "attack" | "flee" = snap.health < 5 ? "flee" : "attack";
          this.submitCombatTask(entity as unknown as Parameters<typeof this.submitCombatTask>[0], action);
        }
      }

      // Hunger → enqueue eat task (HIGH when low, CRITICAL when severe)
      if (snap.food <= 14 && this.hunger.hasFood()) {
        const hasEatTask = this.arbitrator.getAllTasks().some((t) =>
          t.type === "eat_food" && (t.status === "pending" || t.status === "ready" || t.status === "running"),
        );
        if (!hasEatTask) {
          const severe = snap.food <= 6;
          this.arbitrator.enqueue(createTask({
            type: "eat_food",
            priority: severe ? "CRITICAL" : "HIGH",
            interruptible: !severe,
            timeoutMs: 10_000,
            goal: severe ? "eat (critical hunger)" : "eat (low hunger)",
          }));
        }
      }
    });

    // Hazard watcher — escape lava / fire (debounced with TTL to avoid queue flooding)
    let lastHazardEscapeAt = 0;
    const HAZARD_DEBOUNCE_MS = 8_000;
    this.hazardWatcherStop = this.perception.subscribe((snap) => {
      const dangerHazard = snap.hazards.find((h) => h.distance < 2.5 && (h.kind === "lava" || h.kind === "fire"));
      if (!dangerHazard) return;

      // Skip if a hazard-escape goto is currently running or queued
      const hazardTaskInFlight = this.arbitrator.getAllTasks().some(
        (t) => t.type === "goto_position" && t.metadata["hazard"] !== undefined &&
               (t.status === "pending" || t.status === "ready" || t.status === "running"),
      );
      if (hazardTaskInFlight) return;
      if (Date.now() - lastHazardEscapeAt < HAZARD_DEBOUNCE_MS) return;
      lastHazardEscapeAt = Date.now();

      const pos = this.bot.entity?.position;
      if (!pos) return;
      const dx = pos.x - dangerHazard.position.x;
      const dz = pos.z - dangerHazard.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      this.arbitrator.enqueue(createTask({
        type: "goto_position",
        priority: "CRITICAL",
        interruptible: false,
        timeoutMs: 20_000,
        metadata: {
          x: pos.x + (dx / len) * 8,
          y: pos.y,
          z: pos.z + (dz / len) * 8,
          range: 2,
          hazard: dangerHazard.kind,
        },
        goal: `escape ${dangerHazard.kind}`,
      }));
    });

    this.bot.on("death", () => {
      this.arbitrator.cancelAll("bot_died");
      this.memory.episodic.record({
        kind: "death",
        description: "Bot died",
        position: this.bot.entity?.position ? {
          x: this.bot.entity.position.x,
          y: this.bot.entity.position.y,
          z: this.bot.entity.position.z,
        } : undefined,
      });
      logger.debug("Bot died");
    });

    // Periodic prune of completed tasks (keeps queue clean)
    this.pruneInterval = setInterval(() => this.arbitrator.pruneCompleted(), 60_000);
  }

  private submitCombatTask(entity: { type: string; name?: string; position: { x: number; y: number; z: number } } & { id?: number }, action: "attack" | "flee") {
    const entityId = (entity as { id?: number }).id;
    if (entityId === undefined) return;
    const taskType = action === "attack" ? "engage_hostile" : "flee_threat";

    // Don't enqueue duplicate combat tasks for the same target
    const existing = this.arbitrator.getAllTasks().find(
      (t) => t.type === taskType && t.metadata["entityId"] === entityId &&
             (t.status === "pending" || t.status === "ready" || t.status === "running"),
    );
    if (existing) return;

    this.arbitrator.enqueue(createTask({
      type: taskType,
      target: String(entityId),
      priority: "HIGH",
      interruptible: true,
      timeoutMs: 30_000,
      metadata: { entityId, entityName: entity.name },
      goal: `${action} ${entity.name ?? "hostile"}`,
    }));

    this.memory.episodic.record({
      kind: "combat_encounter",
      description: `${action} ${entity.name ?? "hostile"}`,
      position: entity.position,
      participants: entity.name ? [entity.name] : undefined,
    });
  }

  private onTaskComplete(task: Task) {
    if (task.status === "failed" || task.status === "blocked") {
      this.memory.shortTerm.recordFailure(task.type, task.failureReason ?? "unknown");
      this.memory.episodic.record({
        kind: "task_failed",
        description: `${task.goal} failed: ${task.failureReason ?? "unknown"}`,
        metadata: { taskType: task.type, taskId: task.id },
      });
    } else if (task.status === "succeeded" && task.type === "build_structure") {
      const pos = this.bot.entity?.position;
      this.memory.episodic.record({
        kind: "successful_build",
        description: `Built ${task.target}`,
        position: pos ? { x: pos.x, y: pos.y, z: pos.z } : undefined,
      });
      if (task.target && pos) {
        this.memory.semantic.rememberLocation({
          name: `${task.target}-${Date.now()}`,
          position: { x: pos.x, y: pos.y, z: pos.z },
          kind: "base",
          description: `${task.target} built here`,
        });
      }
    }
  }

  /**
   * Plan an intent and enqueue the resulting Task[] in the Arbitrator.
   * Returns the plan id and task count for caller visibility.
   */
  submitIntent(intent: LLMIntent): { planId: string; taskCount: number } | null {
    logger.debug({ intent }, "FastBrain: submitting intent");

    if (intent.chat) {
      this.humanization.situationalReaction().catch(() => {});
      this.social.say(intent.chat).catch(() => {});
    }

    if (intent.intent === "stop") {
      this.arbitrator.cancelAll("user_stop");
      this.memory.shortTerm.currentGoal = null;
      return { planId: "stop", taskCount: 0 };
    }

    const ctx: PlanContext = {
      perception: this.perception.get(),
      memory: this.memory,
      botUsername: this.bot.username,
      closestPlayer: this.social.getClosestPlayer(),
    };

    const tasks = this.planner.buildTasks(intent, ctx);
    if (tasks.length === 0) return { planId: "noop", taskCount: 0 };
    const planId = tasks[0]?.planId ?? randomUUID();

    // Make room: cancel current NORMAL/LOW work, leave CRITICAL/HIGH alone
    const current = this.arbitrator.getCurrent();
    if (current && (current.priority === "NORMAL" || current.priority === "LOW") && current.interruptible) {
      this.arbitrator.cancel(current.id);
    }

    this.memory.shortTerm.currentGoal = tasks[0]?.goal ?? intent.intent;
    this.arbitrator.enqueueMany(tasks);

    return { planId, taskCount: tasks.length };
  }

  /** Derive a BotState from the currently-running task type. */
  get state(): BotState {
    const cur = this.arbitrator.getCurrent();
    if (!cur) return "idle";
    switch (cur.type) {
      case "mine_resource":
      case "ensure_inventory":
        return "mining";
      case "build_structure":
        return "building";
      case "follow_player":
      case "goto_player":
      case "goto_position":
        return "following";
      case "engage_hostile":
        return "combat";
      case "flee_threat":
        return "fleeing";
      case "eat_food":
        return "eating";
      case "explore":
        return "exploring";
      default:
        return "idle";
    }
  }

  getCurrentTask(): string | null {
    const cur = this.arbitrator.getCurrent();
    return cur ? cur.goal : null;
  }

  teardown() {
    this.arbitrator.cancelAll("teardown");
    this.threatWatcherStop?.();
    this.hazardWatcherStop?.();
    this.threatWatcherStop = null;
    this.hazardWatcherStop = null;
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
    this.perception.stop();
    this.humanization.stop();
    this.hunger.stop();
  }
}
