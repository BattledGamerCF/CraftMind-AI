import { logger } from "../../lib/logger.js";
import type { Task, TaskStatus } from "./Task.js";
import { priorityRank } from "./Task.js";
import type { Telemetry } from "./Telemetry.js";

export interface TaskExecutor {
  type: Task["type"];
  execute(task: Task, signal: AbortSignal): Promise<void>;
}

interface RunningTask {
  task: Task;
  abort: AbortController;
  promise: Promise<void>;
}

export class Arbitrator {
  private tasks = new Map<string, Task>();
  private executors = new Map<string, TaskExecutor>();
  private current: RunningTask | null = null;
  private telemetry: Telemetry | null = null;
  private onTaskComplete: ((task: Task) => void) | null = null;

  setTelemetry(telemetry: Telemetry) {
    this.telemetry = telemetry;
  }

  setOnTaskComplete(cb: (task: Task) => void) {
    this.onTaskComplete = cb;
  }

  registerExecutor(executor: TaskExecutor) {
    this.executors.set(executor.type, executor);
  }

  enqueue(task: Task): void {
    // Dedup: skip NORMAL/LOW tasks when an identical task is already active
    if (task.priority === "NORMAL" || task.priority === "LOW") {
      const dup = Array.from(this.tasks.values()).find(
        (t) =>
          t.type === task.type &&
          t.target === task.target &&
          (t.status === "pending" || t.status === "ready" || t.status === "running"),
      );
      if (dup) {
        logger.debug({ type: task.type, target: task.target }, "Task deduped (already active)");
        return;
      }
    }
    this.tasks.set(task.id, task);
    logger.debug({ id: task.id, type: task.type, priority: task.priority, goal: task.goal }, "Task enqueued");
    this.tick();
  }

  enqueueMany(tasks: Task[]): void {
    for (const t of tasks) this.tasks.set(t.id, t);
    this.tick();
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (this.current?.task.id === taskId) {
      this.current.abort.abort();
    } else if (task.status === "pending" || task.status === "ready") {
      this.setStatus(task, "cancelled");
    }
  }

  cancelAll(reason = "manual_cancel"): void {
    for (const task of this.tasks.values()) {
      if (task.status === "pending" || task.status === "ready") {
        task.failureReason = reason;
        this.setStatus(task, "cancelled");
      }
    }
    if (this.current) this.current.abort.abort();
  }

  cancelByType(type: Task["type"]): void {
    for (const task of this.tasks.values()) {
      if (task.type === type) this.cancel(task.id);
    }
  }

  getCurrent(): Task | null {
    return this.current?.task ?? null;
  }

  getQueue(): Task[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === "pending" || t.status === "ready")
      .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  private tick(): void {
    this.updateReadiness();

    const next = this.pickNext();
    if (!next) return;

    if (this.current) {
      const currentRank = priorityRank(this.current.task.priority);
      const nextRank = priorityRank(next.priority);
      if (nextRank > currentRank && this.current.task.interruptible) {
        logger.debug(
          { preempted: this.current.task.id, by: next.id, fromPriority: this.current.task.priority, toPriority: next.priority },
          "Preempting current task",
        );
        this.current.abort.abort();
        // The current task's finally() will call tick() again to start the next one.
      }
      return;
    }

    this.start(next);
  }

  private updateReadiness(): void {
    for (const task of this.tasks.values()) {
      if (task.status !== "pending") continue;
      let isBlocked = false;
      let stillWaiting = false;
      for (const id of task.prerequisites) {
        const prereq = this.tasks.get(id);
        if (!prereq) {
          task.failureReason = `prerequisite ${id} not found`;
          this.setStatus(task, "blocked");
          isBlocked = true;
          break;
        }
        if (prereq.status === "failed" || prereq.status === "cancelled" || prereq.status === "blocked") {
          task.failureReason = `prerequisite ${id} ${prereq.status}`;
          this.setStatus(task, "blocked");
          isBlocked = true;
          break;
        }
        if (prereq.status !== "succeeded") {
          stillWaiting = true;
        }
      }
      if (!isBlocked && !stillWaiting) {
        this.setStatus(task, "ready");
      }
    }
  }

  private pickNext(): Task | null {
    const ready = Array.from(this.tasks.values()).filter((t) => t.status === "ready");
    if (ready.length === 0) return null;
    ready.sort((a, b) => {
      const dp = priorityRank(b.priority) - priorityRank(a.priority);
      if (dp !== 0) return dp;
      return a.createdAt - b.createdAt;
    });
    return ready[0] ?? null;
  }

  private start(task: Task): void {
    const executor = this.executors.get(task.type);
    if (!executor) {
      task.failureReason = `no executor for type ${task.type}`;
      logger.error({ type: task.type, id: task.id }, "No executor registered for task type");
      this.setStatus(task, "failed");
      this.tick();
      return;
    }

    const abort = new AbortController();
    task.startedAt = Date.now();
    this.setStatus(task, "running");
    logger.info({ id: task.id, type: task.type, priority: task.priority, goal: task.goal }, "Task started");
    this.telemetry?.recordTaskStart(task);

    const timeout = setTimeout(() => {
      logger.debug({ id: task.id, timeoutMs: task.timeoutMs }, "Task timed out");
      abort.abort();
    }, task.timeoutMs);

    const promise = executor
      .execute(task, abort.signal)
      .then(() => {
        if (abort.signal.aborted && task.status === "running") {
          task.failureReason = "aborted";
          this.setStatus(task, "cancelled");
        } else {
          this.setStatus(task, "succeeded");
        }
      })
      .catch((err) => {
        if (abort.signal.aborted) {
          task.failureReason = "aborted";
          this.setStatus(task, "cancelled");
        } else if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          task.status = "ready";
          logger.warn({ id: task.id, type: task.type, retry: task.retryCount, err }, "Task failed — retrying");
        } else {
          task.failureReason = err instanceof Error ? err.message : String(err);
          logger.error({ id: task.id, type: task.type, goal: task.goal, err: task.failureReason }, "Task failed");
          this.setStatus(task, "failed");
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        task.completedAt = Date.now();
        const durationMs = task.startedAt ? task.completedAt - task.startedAt : 0;
        if (task.status === "succeeded") {
          logger.info({ id: task.id, type: task.type, durationMs }, "Task succeeded");
        } else if (task.status === "cancelled") {
          logger.debug({ id: task.id, type: task.type, durationMs }, "Task cancelled");
        }
        this.telemetry?.recordTaskComplete(task);
        this.onTaskComplete?.(task);
        this.current = null;
        // Defer tick so callers can observe the completed state first
        setImmediate(() => this.tick());
      });

    this.current = { task, abort, promise };
  }

  private setStatus(task: Task, status: TaskStatus) {
    task.status = status;
  }

  pruneCompleted(olderThanMs = 5 * 60_000) {
    const cutoff = Date.now() - olderThanMs;
    for (const [id, task] of this.tasks) {
      const isTerminal =
        task.status === "succeeded" || task.status === "failed" ||
        task.status === "cancelled" || task.status === "blocked";
      if (isTerminal && (task.completedAt ?? 0) < cutoff) {
        this.tasks.delete(id);
      }
    }
  }
}
