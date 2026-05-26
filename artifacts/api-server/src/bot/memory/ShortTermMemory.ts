import type { ChatMessage } from "../types.js";

export interface RecentFailure {
  taskType: string;
  reason: string;
  timestamp: number;
}

export interface NearbyThreat {
  name: string;
  distance: number;
  position: { x: number; y: number; z: number };
}

export class ShortTermMemory {
  recentChat: ChatMessage[] = [];
  currentTarget: string | null = null;
  currentGoal: string | null = null;
  nearbyThreats: NearbyThreat[] = [];
  temporaryObjectives: string[] = [];
  recentFailures: RecentFailure[] = [];
  private maxChat = 20;
  private maxFailures = 10;

  pushChat(msg: ChatMessage) {
    this.recentChat.push(msg);
    if (this.recentChat.length > this.maxChat) this.recentChat.shift();
  }

  recordFailure(taskType: string, reason: string) {
    this.recentFailures.push({ taskType, reason, timestamp: Date.now() });
    if (this.recentFailures.length > this.maxFailures) this.recentFailures.shift();
  }

  setThreats(threats: NearbyThreat[]) {
    this.nearbyThreats = threats;
  }

  hasRecentFailure(taskType: string, withinMs = 60_000): boolean {
    const cutoff = Date.now() - withinMs;
    return this.recentFailures.some((f) => f.taskType === taskType && f.timestamp >= cutoff);
  }

  snapshot() {
    return {
      currentTarget: this.currentTarget,
      currentGoal: this.currentGoal,
      nearbyThreats: this.nearbyThreats,
      temporaryObjectives: this.temporaryObjectives,
      recentFailureCount: this.recentFailures.length,
      recentChatCount: this.recentChat.length,
    };
  }
}
