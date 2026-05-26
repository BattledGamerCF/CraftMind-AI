import type { Planner, PlanBuilder } from "../core/Planner.js";
import { createTask } from "../core/Task.js";

const followPlan: PlanBuilder = (intent, ctx) => {
  const target = intent.target ?? ctx.closestPlayer?.name;
  if (!target) {
    return [createTask({ type: "say", target: "no_target", metadata: { message: "Who should I follow?" }, goal: "ask who to follow" })];
  }
  return [
    createTask({ type: "follow_player", target, priority: "NORMAL", interruptible: true, timeoutMs: 600_000, goal: `follow ${target}` }),
  ];
};

const comeHerePlan: PlanBuilder = (intent, ctx) => {
  const target = intent.target ?? ctx.closestPlayer?.name;
  if (!target) return [];
  return [
    createTask({ type: "goto_player", target, priority: "NORMAL", timeoutMs: 60_000, goal: `walk to ${target}` }),
  ];
};

const minePlan: PlanBuilder = (intent) => {
  const resource = intent.target ?? "wood";
  const count = (intent.params?.["count"] as number | undefined) ?? 32;
  return [
    createTask({
      type: "mine_resource",
      target: resource,
      priority: "NORMAL",
      timeoutMs: 5 * 60_000,
      metadata: { count },
      goal: `mine ${count} ${resource}`,
    }),
  ];
};

const buildPlan: PlanBuilder = (intent) => {
  const structure = intent.target ?? "simple_shelter";

  // Hierarchical plan: ensure inventory → place structure
  const requirements: Record<string, Record<string, number>> = {
    oak_cabin: { oak_log: 16, oak_planks: 80, glass: 6, oak_door: 1, oak_stairs: 14, oak_slab: 35, torch: 4 },
    simple_shelter: { cobblestone: 32, dirt: 25, oak_log: 25, torch: 1 },
  };
  const needs = requirements[structure] ?? {};

  const ensureTask = createTask({
    type: "ensure_inventory",
    priority: "NORMAL",
    timeoutMs: 8 * 60_000,
    metadata: { requirements: needs },
    goal: `gather materials for ${structure}`,
  });

  const placeTask = createTask({
    type: "build_structure",
    target: structure,
    priority: "NORMAL",
    timeoutMs: 10 * 60_000,
    prerequisites: [ensureTask.id],
    goal: `build ${structure}`,
  });

  return [ensureTask, placeTask];
};

const explorePlan: PlanBuilder = () => [
  createTask({ type: "explore", priority: "LOW", timeoutMs: 120_000, goal: "explore nearby terrain" }),
];

const gatherFoodPlan: PlanBuilder = () => [
  createTask({
    type: "mine_resource",
    target: "food",
    priority: "NORMAL",
    timeoutMs: 5 * 60_000,
    metadata: { count: 8 },
    goal: "gather food",
  }),
];

const returnHomePlan: PlanBuilder = (_intent, ctx) => {
  const home = ctx.memory?.semantic.getHome();
  if (!home) {
    return [createTask({
      type: "say",
      priority: "NORMAL",
      metadata: { message: "I don't know where home is. Use 'set home' first." },
      goal: "no home set",
    })];
  }
  return [createTask({
    type: "return_home",
    priority: "NORMAL",
    timeoutMs: 3 * 60_000,
    metadata: { x: home.position.x, y: home.position.y, z: home.position.z },
    goal: "return to home base",
  })];
};

const setHomePlan: PlanBuilder = () => [
  createTask({ type: "set_home", priority: "NORMAL", timeoutMs: 10_000, goal: "remember current location as home" }),
];

const cleanupInventoryPlan: PlanBuilder = () => [
  createTask({ type: "cleanup_inventory", priority: "LOW", timeoutMs: 30_000, goal: "clean up inventory" }),
];

const stopPlan: PlanBuilder = () => [];
const idlePlan: PlanBuilder = () => [createTask({ type: "idle", priority: "LOW", goal: "idle" })];

const reportStatusPlan: PlanBuilder = (_intent, ctx) => {
  const snap = ctx.perception;
  const parts = [
    `HP ${snap.health}/20`,
    `food ${snap.food}/20`,
    snap.hostiles.length ? `${snap.hostiles.length} hostiles nearby` : null,
  ].filter(Boolean);
  return [
    createTask({
      type: "say",
      priority: "NORMAL",
      metadata: { message: parts.join(", ") },
      goal: "report status",
      interruptible: false,
    }),
  ];
};

const defendSelfPlan: PlanBuilder = (_intent, ctx) => {
  const target = ctx.perception.hostiles[0];
  if (!target) return [];
  return [
    createTask({
      type: "engage_hostile",
      target: String(target.id),
      priority: "HIGH",
      interruptible: true,
      timeoutMs: 30_000,
      metadata: { entityId: target.id, entityName: target.name },
      goal: `engage ${target.name}`,
    }),
  ];
};

export function registerDefaultPlans(planner: Planner) {
  planner.registerBuilder("follow_player", followPlan);
  planner.registerBuilder("come_here", comeHerePlan);
  planner.registerBuilder("mine_resource", minePlan);
  planner.registerBuilder("build_structure", buildPlan);
  planner.registerBuilder("explore", explorePlan);
  planner.registerBuilder("gather_food", gatherFoodPlan);
  planner.registerBuilder("stop", stopPlan);
  planner.registerBuilder("idle", idlePlan);
  planner.registerBuilder("report_status", reportStatusPlan);
  planner.registerBuilder("defend_self", defendSelfPlan);
  planner.registerBuilder("return_home", returnHomePlan);
  planner.registerBuilder("set_home", setHomePlan);
  planner.registerBuilder("cleanup_inventory", cleanupInventoryPlan);
  planner.setFallback(idlePlan);
}
