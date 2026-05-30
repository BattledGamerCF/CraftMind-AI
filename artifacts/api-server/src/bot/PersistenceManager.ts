import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../lib/logger.js";

const DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".mindcraft", "bots");

export interface PersistedState {
  version: 1;
  botId: string;
  lastSeen: number;
  home?: { x: number; y: number; z: number };
  cognitiveMode?: string;
  currentGoal?: string | null;
  semanticLocations?: Array<{
    name: string;
    position: { x: number; y: number; z: number };
    kind: string;
    description?: string;
  }>;
  trustPlayers?: Array<{
    name: string;
    level: string;
    score: number;
    interactions: number;
    commandsIssued: number;
  }>;
  habits?: {
    idleSpots: Array<{ k: string; x: number; y: number; z: number; weight: number; lastSeen: number }>;
    dangerMarks: Array<{ x: number; z: number; weight: number; expiry: number }>;
    players: Array<{ name: string; interactions: number; lastSeen: number }>;
  };
}

export class PersistenceManager {
  private filePath: string;
  private saveTimer: NodeJS.Timeout | null = null;

  /**
   * @param key - Stable identity string (e.g. "username@host_port").
   *              Must NOT be a transient UUID — the key must be the same
   *              across server restarts so state can be restored on reconnect.
   */
  constructor(key: string) {
    // Replace any character that is unsafe in a filename with underscore
    const safe = key.replace(/[^a-zA-Z0-9@._-]/g, "_").toLowerCase();
    this.filePath = join(DATA_DIR, `${safe}.json`);
  }

  async load(): Promise<PersistedState | null> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const state = JSON.parse(raw) as PersistedState;
      if (state.version !== 1) return null;
      logger.info({ botId: state.botId, lastSeen: state.lastSeen }, "PersistenceManager: state restored");
      return state;
    } catch {
      return null;
    }
  }

  async save(state: PersistedState): Promise<void> {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      logger.debug({ err }, "PersistenceManager: save failed");
    }
  }

  /** Debounced save — coalesces rapid changes into one disk write. */
  scheduleSave(state: PersistedState, delayMs = 5_000): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save(state).catch(() => {});
      this.saveTimer = null;
    }, delayMs);
  }

  flush(state: PersistedState): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save(state).catch(() => {});
  }
}
