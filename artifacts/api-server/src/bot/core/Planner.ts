import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger.js";
import type { LLMIntent } from "../types.js";
import type { Task, Plan } from "./Task.js";
import type { PerceptionSnapshot } from "./Perception.js";
import type { MemoryStore } from "../memory/index.js";

export interface PlanContext {
  perception: PerceptionSnapshot;
  memory: MemoryStore;
  botUsername: string;
  closestPlayer?: { name: string; distance: number } | null;
}

export type PlanBuilder = (intent: LLMIntent, ctx: PlanContext) => Task[];

export class Planner {
  private builders = new Map<string, PlanBuilder>();
  private fallback: PlanBuilder | null = null;

  registerBuilder(intentName: string, builder: PlanBuilder) {
    this.builders.set(intentName, builder);
  }

  setFallback(builder: PlanBuilder) {
    this.fallback = builder;
  }

  /**
   * Build tasks for an intent without creating a Plan wrapper. Returns the concrete
   * Task[] so callers can enqueue them into the Arbitrator.
   */
  buildTasks(intent: LLMIntent, ctx: PlanContext): Task[] {
    const builder = this.builders.get(intent.intent) ?? this.fallback;
    if (!builder) {
      logger.warn({ intent: intent.intent }, "No plan builder for intent");
      return [];
    }
    const tasks = builder(intent, ctx);
    if (tasks.length === 0) return [];
    const planId = randomUUID();
    for (const t of tasks) t.planId = planId;
    return tasks;
  }

  plan(intent: LLMIntent, ctx: PlanContext): Plan | null {
    const tasks = this.buildTasks(intent, ctx);
    if (tasks.length === 0) return null;
    const plan: Plan = {
      id: tasks[0]!.planId!,
      goal: intent.chat ?? intent.intent,
      taskIds: tasks.map((t) => t.id),
      createdAt: Date.now(),
    };
    logger.debug({ planId: plan.id, goal: plan.goal, taskCount: tasks.length }, "Plan created");
    return plan;
  }
}
