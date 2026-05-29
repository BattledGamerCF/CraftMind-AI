import { useState, useEffect, useCallback, useRef } from "react";
import { api, type BotStatus, type RuntimeData, type MetaData, type CreateBotPayload } from "./api";

const DEFAULT_MODELS: Record<string, string> = {
  ollama: "llama3.2",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku-20240307",
};

function stateBadge(state: string, connected: boolean) {
  if (!connected) return <span className="badge badge-red"><span className="dot" />offline</span>;
  const map: Record<string, string> = {
    idle: "badge-gray",
    following: "badge-blue",
    mining: "badge-yellow",
    building: "badge-blue",
    combat: "badge-red",
    fleeing: "badge-red",
    eating: "badge-green",
    exploring: "badge-blue",
  };
  return (
    <span className={`badge ${map[state] ?? "badge-gray"}`}>
      <span className="dot" />
      {state}
    </span>
  );
}

function riskColor(r: number) {
  if (r >= 0.7) return "danger";
  if (r >= 0.4) return "warn";
  return "accent";
}

// ── Create Bot Modal ─────────────────────────────────────────────────────────

interface CreateModalProps {
  meta: MetaData | null;
  onClose: () => void;
  onCreated: (bot: BotStatus) => void;
}

function CreateModal({ meta, onClose, onCreated }: CreateModalProps) {
  const [form, setForm] = useState({
    host: "localhost",
    port: "25565",
    username: "MindBot",
    version: "",
    auth: "offline" as "offline" | "microsoft",
    provider: "ollama",
    model: "llama3.2",
    ollamaUrl: "",
    cognitiveMode: "balanced",
    playstyle: "companion",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setField<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "provider") {
        next.model = DEFAULT_MODELS[v as string] ?? "";
      }
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload: CreateBotPayload = {
        host: form.host,
        port: Number(form.port) || 25565,
        username: form.username,
        auth: form.auth,
        llm: {
          provider: form.provider,
          model: form.model,
          ...(form.provider === "ollama" && form.ollamaUrl
            ? { baseUrl: form.ollamaUrl }
            : {}),
        },
        cognitiveMode: form.cognitiveMode,
        playstyle: form.playstyle,
        ...(form.version ? { version: form.version } : {}),
      };
      const bot = await api.createBot(payload);
      onCreated(bot);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create bot");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Connect a Bot</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {err && (
          <div className="error-banner" style={{ marginBottom: 16 }}>
            {err}
            <button onClick={() => setErr(null)}>✕</button>
          </div>
        )}

        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-section-title" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
              Minecraft Server
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>Host</label>
                <input
                  required
                  value={form.host}
                  onChange={(e) => setField("host", e.target.value)}
                  placeholder="localhost"
                />
              </div>
              <div className="form-field">
                <label>Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => setField("port", e.target.value)}
                  placeholder="25565"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-field">
                <label>Bot Username</label>
                <input
                  required
                  value={form.username}
                  onChange={(e) => setField("username", e.target.value)}
                  placeholder="MindBot"
                />
              </div>
              <div className="form-field">
                <label>Auth Mode</label>
                <select
                  value={form.auth}
                  onChange={(e) => setField("auth", e.target.value as "offline" | "microsoft")}
                >
                  <option value="offline">Offline (local)</option>
                  <option value="microsoft">Microsoft (online)</option>
                </select>
              </div>
            </div>

            <div className="form-field">
              <label>
                Minecraft Version{" "}
                <span style={{ color: "var(--text-dim)", fontWeight: 400, textTransform: "none" }}>
                  (optional — auto-detect if blank)
                </span>
              </label>
              <select
                value={form.version}
                onChange={(e) => setField("version", e.target.value)}
              >
                <option value="">Auto-detect</option>
                {(meta?.testedVersions ?? []).map((v) => (
                  <option key={v} value={v}>
                    {v}{v === meta?.latestTested ? " ✓ latest tested" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-section-title">LLM Provider</div>

            <div className="form-row">
              <div className="form-field">
                <label>Provider</label>
                <select
                  value={form.provider}
                  onChange={(e) => setField("provider", e.target.value)}
                >
                  {(meta?.providers ?? ["ollama", "openai", "anthropic"]).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Model</label>
                <input
                  required
                  value={form.model}
                  onChange={(e) => setField("model", e.target.value)}
                  placeholder={DEFAULT_MODELS[form.provider] ?? "model name"}
                />
              </div>
            </div>

            {form.provider === "ollama" && (
              <div className="form-field">
                <label>
                  Ollama URL{" "}
                  <span style={{ color: "var(--text-dim)", fontWeight: 400, textTransform: "none" }}>
                    (default: http://localhost:11434)
                  </span>
                </label>
                <input
                  value={form.ollamaUrl}
                  onChange={(e) => setField("ollamaUrl", e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </div>
            )}

            <div className="form-section-title">Behaviour</div>

            <div className="form-row">
              <div className="form-field">
                <label>Cognitive Mode</label>
                <select
                  value={form.cognitiveMode}
                  onChange={(e) => setField("cognitiveMode", e.target.value)}
                >
                  {(meta?.cognitiveModes ?? ["balanced"]).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Playstyle</label>
                <select
                  value={form.playstyle}
                  onChange={(e) => setField("playstyle", e.target.value)}
                >
                  {(meta?.playstyles ?? ["companion"]).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Connecting…" : "Connect Bot"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Quick Actions ─────────────────────────────────────────────────────────────

interface QuickActionsProps {
  botId: string;
  onError: (msg: string) => void;
}

function QuickActions({ botId, onError }: QuickActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, command: string, args?: Record<string, unknown>) {
    setBusy(label);
    try {
      await api.sendCommand(botId, command, args);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Command failed");
    } finally {
      setBusy(null);
    }
  }

  const actions = [
    { label: "Follow", command: "follow", args: undefined },
    { label: "Mine Wood", command: "mine", args: { resource: "wood" } },
    { label: "Build Shelter", command: "build", args: { structure: "simple_shelter" } },
    { label: "Return Home", command: "return_home", args: undefined },
    { label: "Report Status", command: "report_status", args: undefined },
  ];

  return (
    <div className="card">
      <div className="card-title">Quick Actions</div>
      <div className="action-row">
        {actions.map((a) => (
          <button
            key={a.label}
            className="btn-action"
            disabled={busy !== null}
            onClick={() => run(a.label, a.command, a.args)}
          >
            {busy === a.label ? <span className="loading-dot" /> : null}
            {a.label}
          </button>
        ))}
        <button
          className="btn-action stop"
          disabled={busy !== null}
          onClick={() => run("Stop", "stop")}
        >
          {busy === "Stop" ? <span className="loading-dot" /> : null}
          Stop
        </button>
      </div>
    </div>
  );
}

// ── Runtime Panel ─────────────────────────────────────────────────────────────

interface RuntimePanelProps {
  runtime: RuntimeData;
}

function RuntimePanel({ runtime }: RuntimePanelProps) {
  const { task, zone, operationalState, cognitiveMode, playstyle, riskScore, alertness, memory, telemetry } = runtime;

  return (
    <>
      <div className="card">
        <div className="card-title">Status</div>
        <div className="stat-grid">
          <div className="stat-item">
            <div className="stat-label">Zone</div>
            <div className="stat-value">{zone}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">State</div>
            <div className="stat-value">{operationalState}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Playstyle</div>
            <div className="stat-value">{playstyle?.profile ?? "—"}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Cognitive Mode</div>
            <div className="stat-value">{cognitiveMode}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Risk</div>
            <div className={`stat-value ${riskColor(riskScore)}`}>{(riskScore * 100).toFixed(0)}%</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Alertness</div>
            <div className="stat-value">{(alertness * 100).toFixed(0)}%</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Task Queue</div>
        <div className="stat-grid">
          <div className="stat-item">
            <div className="stat-label">Current Task</div>
            <div className="stat-value" style={{ fontSize: 13 }}>
              {task.current?.type ?? "idle"}
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Queue Length</div>
            <div className="stat-value">{task.queueLength}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Goal</div>
            <div className="stat-value" style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {memory.goal ?? "none"}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Telemetry</div>
        <div className="stat-grid">
          <div className="stat-item">
            <div className="stat-label">Total Tasks</div>
            <div className="stat-value">{telemetry.totalTasks}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Success Rate</div>
            <div className={`stat-value ${telemetry.successRate >= 0.7 ? "accent" : "warn"}`}>
              {((telemetry.successRate ?? 0) * 100).toFixed(0)}%
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Threats</div>
            <div className={`stat-value ${memory.threatCount > 0 ? "danger" : ""}`}>
              {memory.threatCount}
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Waypoints</div>
            <div className="stat-value">{memory.waypointCount}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">Events Logged</div>
            <div className="stat-value">{memory.episodicEventCount}</div>
          </div>
        </div>
      </div>

      {memory.recentEvents.length > 0 && (
        <div className="card">
          <div className="card-title">Recent Events</div>
          <div className="event-list">
            {memory.recentEvents.map((ev, i) => (
              <div key={i} className="event-item">
                <div className="event-kind">{ev.kind}</div>
                <div className="event-desc">{ev.description}</div>
                <div className="event-time">{ev.minsAgo}m ago</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [bots, setBots] = useState<BotStatus[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeData | null>(null);
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const loadBots = useCallback(async () => {
    try {
      const list = await api.listBots();
      setBots(list);
      // Auto-clear selection if bot was removed
      if (selectedIdRef.current && !list.find((b) => b.id === selectedIdRef.current)) {
        setSelectedId(null);
        setRuntime(null);
      }
    } catch {
      // server may be starting — silently ignore
    }
  }, []);

  const loadRuntime = useCallback(async (id: string) => {
    try {
      const data = await api.getRuntime(id);
      setRuntime(data);
    } catch {
      setRuntime(null);
    }
  }, []);

  // Load meta once
  useEffect(() => {
    api.getMeta().then(setMeta).catch(() => {});
  }, []);

  // Poll bot list
  useEffect(() => {
    loadBots();
    if (!polling) return;
    const t = setInterval(loadBots, 3000);
    return () => clearInterval(t);
  }, [loadBots, polling]);

  // Poll runtime for selected bot
  useEffect(() => {
    if (!selectedId) { setRuntime(null); return; }
    loadRuntime(selectedId);
    if (!polling) return;
    const t = setInterval(() => loadRuntime(selectedId), 2000);
    return () => clearInterval(t);
  }, [selectedId, loadRuntime, polling]);

  async function handleDelete(id: string) {
    try {
      await api.deleteBot(id);
      if (selectedId === id) { setSelectedId(null); setRuntime(null); }
      await loadBots();
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : "Failed to disconnect bot");
    }
  }

  const selectedBot = bots.find((b) => b.id === selectedId) ?? null;

  return (
    <div id="root">
      <header className="app-header">
        <span style={{ fontSize: 18 }}>⛏</span>
        <h1>Mindcraft</h1>
        <span className="subtitle">Bot Dashboard</span>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setPolling((p) => !p)}
          title={polling ? "Pause auto-refresh" : "Resume auto-refresh"}
        >
          {polling ? "⏸ Live" : "▶ Paused"}
        </button>
      </header>

      <div className="app-body">
        {/* Sidebar — bot list */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Bots ({bots.length})</h2>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreate(true)}
            >
              + New Bot
            </button>
          </div>

          <div className="bot-list">
            {bots.length === 0 && (
              <div style={{ padding: "20px 16px", color: "var(--text-dim)", fontSize: 12 }}>
                No bots connected. Click <strong style={{ color: "var(--text-muted)" }}>+ New Bot</strong> to get started.
              </div>
            )}
            {bots.map((bot) => (
              <div
                key={bot.id}
                className={`bot-item ${selectedId === bot.id ? "selected" : ""}`}
                onClick={() => setSelectedId(bot.id)}
              >
                <div className="bot-item-top">
                  <span className="bot-name">{bot.username}</span>
                  {stateBadge(bot.state, bot.connected)}
                </div>
                <div className="bot-meta">
                  <span>{bot.server}</span>
                  <span>·</span>
                  <span>{bot.cognitiveMode}</span>
                </div>
                {bot.currentTask && (
                  <div className="bot-task">↳ {bot.currentTask}</div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* Main panel */}
        <main className="main-panel">
          {cmdError && (
            <div className="error-banner">
              {cmdError}
              <button onClick={() => setCmdError(null)}>✕</button>
            </div>
          )}

          {!selectedBot ? (
            <div className="empty-state">
              <span style={{ fontSize: 40 }}>⛏</span>
              <h3>Select a bot</h3>
              <p style={{ fontSize: 12 }}>
                {bots.length === 0
                  ? "Connect your first bot with the New Bot button"
                  : "Click a bot in the sidebar to see its runtime status"}
              </p>
            </div>
          ) : (
            <>
              {/* Bot header */}
              <div className="bot-header-row">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2>{selectedBot.username}</h2>
                  {stateBadge(selectedBot.state, selectedBot.connected)}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 12, alignItems: "center" }}>
                    {selectedBot.position && (
                      <span>
                        {Math.round(selectedBot.position.x)},{" "}
                        {Math.round(selectedBot.position.y)},{" "}
                        {Math.round(selectedBot.position.z)}
                      </span>
                    )}
                    <span>❤ {selectedBot.health}/20</span>
                    <span>🍖 {selectedBot.food}/20</span>
                  </div>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(selectedBot.id)}
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {/* Quick actions */}
              <QuickActions
                botId={selectedBot.id}
                onError={setCmdError}
              />

              {/* Runtime data */}
              {runtime ? (
                <RuntimePanel runtime={runtime} />
              ) : (
                <div className="card" style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  <span className="loading-dot" style={{ marginRight: 8 }} />
                  Loading runtime data…
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {showCreate && (
        <CreateModal
          meta={meta}
          onClose={() => setShowCreate(false)}
          onCreated={async (bot) => {
            await loadBots();
            setSelectedId(bot.id);
          }}
        />
      )}
    </div>
  );
}
