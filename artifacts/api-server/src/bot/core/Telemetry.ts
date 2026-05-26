import type { Task } from "./Task.js";

export interface TaskRecord {
  id: string;
  type: Task["type"];
  goal: string;
  priority: Task["priority"];
  status: Task["status"];
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  failureReason: string | null;
  retryCount: number;
}

export interface FailureSummary {
  totalFailures: number;
  byType: Record<string, number>;
  byReason: Record<string, number>;
  recentFailures: TaskRecord[];
}

export interface TelemetryStats {
  totalTasks: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  blocked: number;
  successRate: number;
  averageDurationMs: number;
  byType: Record<string, { count: number; succeeded: number; failed: number; avgDurationMs: number }>;
}

export class Telemetry {
  private records: TaskRecord[] = [];
  private maxRecords = 500;

  recordTaskStart(_task: Task) {
    // Placeholder for future per-start logging; records added on completion to keep durations intact.
  }

  recordTaskComplete(task: Task) {
    const startedAt = task.startedAt ?? task.createdAt;
    const completedAt = task.completedAt ?? Date.now();
    const record: TaskRecord = {
      id: task.id,
      type: task.type,
      goal: task.goal,
      priority: task.priority,
      status: task.status,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      failureReason: task.failureReason ?? null,
      retryCount: task.retryCount,
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }

  getRecords(limit = 50): TaskRecord[] {
    return this.records.slice(-limit).reverse();
  }

  summarizeFailures(timeWindowMs: number): FailureSummary {
    const since = Date.now() - timeWindowMs;
    const failures = this.records.filter(
      (r) => (r.status === "failed" || r.status === "cancelled" || r.status === "blocked") && (r.completedAt ?? 0) >= since,
    );

    const byType: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    for (const f of failures) {
      byType[f.type] = (byType[f.type] ?? 0) + 1;
      const reason = f.failureReason ?? "unknown";
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }

    return {
      totalFailures: failures.length,
      byType,
      byReason,
      recentFailures: failures.slice(-10).reverse(),
    };
  }

  getStats(): TelemetryStats {
    const byType: TelemetryStats["byType"] = {};
    let succeeded = 0, failed = 0, cancelled = 0, blocked = 0;
    let totalDuration = 0;
    let durationCount = 0;

    for (const r of this.records) {
      if (r.status === "succeeded") succeeded++;
      else if (r.status === "failed") failed++;
      else if (r.status === "cancelled") cancelled++;
      else if (r.status === "blocked") blocked++;

      if (r.durationMs !== null) {
        totalDuration += r.durationMs;
        durationCount++;
      }

      const bucket = (byType[r.type] ??= { count: 0, succeeded: 0, failed: 0, avgDurationMs: 0 });
      bucket.count++;
      if (r.status === "succeeded") bucket.succeeded++;
      if (r.status === "failed") bucket.failed++;
      if (r.durationMs !== null) {
        bucket.avgDurationMs = (bucket.avgDurationMs * (bucket.count - 1) + r.durationMs) / bucket.count;
      }
    }

    const total = this.records.length;
    return {
      totalTasks: total,
      succeeded,
      failed,
      cancelled,
      blocked,
      successRate: total > 0 ? succeeded / total : 0,
      averageDurationMs: durationCount > 0 ? totalDuration / durationCount : 0,
      byType,
    };
  }

  clear() {
    this.records = [];
  }
}
