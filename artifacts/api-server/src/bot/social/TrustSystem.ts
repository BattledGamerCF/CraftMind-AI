export type TrustLevel = "hostile" | "neutral" | "friendly" | "trusted" | "owner";

export interface PlayerTrust {
  name: string;
  level: TrustLevel;
  score: number;
  interactions: number;
  helpfulEvents: number;
  hostileEvents: number;
  commandsIssued: number;
  lastSeen: number;
}

export class TrustSystem {
  private players = new Map<string, PlayerTrust>();

  private getOrCreate(name: string): PlayerTrust {
    if (!this.players.has(name)) {
      this.players.set(name, {
        name,
        level: "neutral",
        score: 40,
        interactions: 0,
        helpfulEvents: 0,
        hostileEvents: 0,
        commandsIssued: 0,
        lastSeen: Date.now(),
      });
    }
    return this.players.get(name)!;
  }

  private computeLevel(score: number): TrustLevel {
    if (score <= 10) return "hostile";
    if (score <= 35) return "neutral";
    if (score <= 65) return "friendly";
    return "trusted";
  }

  /** Record a chat message from a player. isCommand=true when it triggers an action. */
  onInteraction(name: string, isCommand = false) {
    const p = this.getOrCreate(name);
    p.interactions++;
    if (isCommand) p.commandsIssued++;
    // Slow score gain: +1 per interaction, +2 if commanding
    p.score = Math.min(100, p.score + (isCommand ? 2 : 1));
    p.lastSeen = Date.now();
    if (p.level !== "owner") p.level = this.computeLevel(p.score);
  }

  onHostileEvent(name: string, severity = 8) {
    const p = this.getOrCreate(name);
    p.hostileEvents++;
    p.score = Math.max(0, p.score - severity);
    if (p.level !== "owner") p.level = this.computeLevel(p.score);
  }

  onHelpfulEvent(name: string, bonus = 5) {
    const p = this.getOrCreate(name);
    p.helpfulEvents++;
    p.score = Math.min(100, p.score + bonus);
    if (p.level !== "owner") p.level = this.computeLevel(p.score);
  }

  setOwner(name: string) {
    const p = this.getOrCreate(name);
    p.level = "owner";
    p.score = 100;
  }

  getTrust(name: string): PlayerTrust | null {
    return this.players.get(name) ?? null;
  }

  /** Whether this player's commands should be prioritized over strangers. */
  shouldPrioritize(name: string): boolean {
    const p = this.players.get(name);
    return !!p && (p.level === "owner" || p.level === "trusted" || p.score >= 60);
  }

  snapshot(): PlayerTrust[] {
    return Array.from(this.players.values())
      .sort((a, b) => b.score - a.score);
  }
}
