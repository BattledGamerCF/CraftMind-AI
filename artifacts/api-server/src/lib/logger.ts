import pino from "pino";
import { Writable } from "node:stream";

// ── In-memory log ring buffer ─────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 500;

export interface LogEntry {
  level: string;
  time: number;
  msg: string;
  [key: string]: unknown;
}

const LEVEL_NAMES: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const _buf: LogEntry[] = [];

export const logBuffer = {
  push(raw: string) {
    try {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      _buf.push({
        ...obj,
        level: LEVEL_NAMES[(obj["level"] as number)] ?? "info",
        time: (obj["time"] as number) ?? Date.now(),
        msg: (obj["msg"] as string) ?? "",
      });
      if (_buf.length > MAX_LOG_ENTRIES) _buf.shift();
    } catch {
      // ignore malformed lines
    }
  },
  recent(n = 200): LogEntry[] {
    return _buf.slice(-n);
  },
};

// Writable stream that feeds the ring buffer
const ringStream = new Writable({
  write(chunk: Buffer, _enc, cb) {
    logBuffer.push(chunk.toString());
    cb();
  },
});

// ── Build pino logger with multistream ────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production";
const VALID_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);
const rawLevel = process.env.LOG_LEVEL ?? "info";
const logLevel = (VALID_LEVELS.has(rawLevel) ? rawLevel : "info") as pino.Level;

const streams: pino.StreamEntry[] = [
  { stream: ringStream, level: "debug" },
];

if (!isProduction) {
  streams.unshift({
    stream: pino.transport({ target: "pino-pretty", options: { colorize: true } }),
    level: logLevel,
  });
} else {
  streams.unshift({ stream: process.stdout, level: logLevel });
}

export const logger = pino(
  {
    level: "debug",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.apiKey",
      "*.api_key",
    ],
  },
  pino.multistream(streams),
);
