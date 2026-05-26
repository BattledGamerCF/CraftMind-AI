import { randomUUID } from "node:crypto";

export type TaskPriority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export const PRIORITY_VALUES: Record<TaskPriority, number> = {
  CRITICAL: 100,
  HIGH: 75,
  NORMAL: 50,
  LOW: 25,
};

export type TaskStatus =
  | "pending"      // waiting in queue
  | "ready"        // prerequisites satisfied, ready to run
  | "running"      // currently executing
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked";     // prereq failed

export type TaskType =
  | "mine_resource"
  | "build_structure"
  | "follow_player"
  | "goto_position"
  | "goto_player"
  | "explore"
  | "engage_hostile"
  | "flee_threat"
  | "eat_food"
  | "say"
  | "idle"
  | "ensure_inventory"
  | "equip_armor";

export interface Task {
  id: string;
  type: TaskType;
  target?: string;
  priority: TaskPriority;
  status: TaskStatus;
  prerequisites: string[];
  timeoutMs: number;
  retryCount: number;
  maxRetries: number;
  interruptible: boolean;
  metadata: Record<string, unknown>;
  parentId?: string;
  planId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  failureReason?: string;
  goal: string;  // human-readable description
}

export interface CreateTaskInput {
  type: TaskType;
  target?: string;
  priority?: TaskPriority;
  prerequisites?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  interruptible?: boolean;
  metadata?: Record<string, unknown>;
  parentId?: string;
  planId?: string;
  goal?: string;
}

export function createTask(input: CreateTaskInput): Task {
  return {
    id: randomUUID(),
    type: input.type,
    target: input.target,
    priority: input.priority ?? "NORMAL",
    status: "pending",
    prerequisites: input.prerequisites ?? [],
    timeoutMs: input.timeoutMs ?? 120_000,
    retryCount: 0,
    maxRetries: input.maxRetries ?? 0,
    interruptible: input.interruptible ?? true,
    metadata: input.metadata ?? {},
    parentId: input.parentId,
    planId: input.planId,
    createdAt: Date.now(),
    goal: input.goal ?? `${input.type}${input.target ? `:${input.target}` : ""}`,
  };
}

export function priorityRank(p: TaskPriority): number {
  return PRIORITY_VALUES[p];
}

export interface Plan {
  id: string;
  goal: string;
  taskIds: string[];
  createdAt: number;
}
