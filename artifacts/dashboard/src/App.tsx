import { useState, useEffect, useCallback, useRef } from "react";
import { api, friendlyError, type BotStatus, type RuntimeData, type MetaData, type CreateBotPayload } from "./api";

const DEFAULT_MODELS: Record<string, string> = {
  ollama: "llama3.2",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku-20240307",
};

const COGNITIVE_LABELS: Record<string, string> = {
  deterministic:   "Deterministic — rule-based only, no LLM",
  lightweight:     "Lightweight — fast, minimal reasoning",
  balanced:        "Balanced — recommended",
  auto:            "Auto — adapts to situation",
  "deep-reasoning":"Deep Reasoning — slowest, most capable",
};

const PLAYSTYLE_LABELS: Record<string, string> = {
  companion:  "Companion — follows and assists the player",
  worker:     "Worker — focused on assigned tasks",
  adventurer: "Adventurer — explores and acts freely",
  safe:       "Safe — avoids combat and high-risk actions",
  auto:       "Auto — adapts dynamically to context",
};

// ── Connection / State badge ──────────────────────────────────────────────────

function ConnectionBadge({ bot }: { bot: BotStatus }) {
  if (!bot.connected) {
    const connMap: Record<string, [string, string]> = {
      connecting:   ["badge-yellow", "connecting"],
      reconnecting: ["badge-yellow", "reconnecting"],
      failed:       ["badge-red",    "failed"],
    };
    const [cls, label] = connMap[bot.state] ?? ["badge-red", "offline"];
    return <span className={`badge ${cls}`}><span className="dot" />{label}</span>;
  }
  const taskMap: Record<string, string> = {
    idle:      "badge-green",
    following: "badge-blue",
    mining:    "badge-yellow",
    building:  "badge-blue",
    combat:    "badge-red",
    fleeing:   "badge-red",
    eating:    "badge-green",
    exploring: "badge-blue",
  };
  const label = bot.state === "idle" ? "online" : bot.state;
  return (
    <span className={`badge ${taskMap[bot.state] ?? "badge-green"}`}>
      <span className="dot" />{label}
    </span>
  );
}

function riskColor(r: number) {
  if (r >= 0.7) return "danger";
  if (r >= 0.4) return "warn";
  return "accent";
}

// ── Create Bot Modal ──────────────────────────────────────────────────────────

interface CreateModalProps {
  meta: MetaData | null;
  onClose: () => void;
  onCreated: (bot: BotStatus) => void;
}

function CreateModal({ meta, onClose, onCreated }: CreateModalProps) {
  const [form, setForm] = useState({
    host: "localhost",
    portRaw: "",
    username: "MindBot",
    version: meta?.latestTested ?? "",
    auth: "offline" as "offline" | "microsoft",
    provider: "ollama",
    model: "llama3.2",
    ollamaUrl: "",
    apiKey: "",
    cognitiveMode: "balanced",
    playstyle: "companion",
  });
  const [portErr, setPortErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const versionAutoSet = useRef(false);

  // Ollama model discovery
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);
  const [ollamaModelsErr, setOllamaModelsErr] = useState<string | null>(null);

  useEffect(() => {
    if (meta?.latestTested && !versionAutoSet.current) {
      versionAutoSet.current = true;
      setForm((f) => (f.version === "" ? { ...f, version: meta.latestTested } : f));
    }
  }, [meta?.latestTested]);

  // Fetch installed Ollama models via API proxy when provider=ollama or URL changes
  useEffect(() => {
    if (form.provider !== "ollama") {
      setOllamaModels(null);
      setOllamaModelsErr(null);
      return;
    }
    let cancelled = false;
    setOllamaModelsLoading(true);
    setOllamaModels(null);
    setOllamaModelsErr(null);

    api.getOllamaModels(form.ollamaUrl || undefined)
      .then((data) => {
        if (cancelled) return;
        setOllamaModels(data.models);
        if (data.error) setOllamaModelsErr(data.error);
        // Auto-select first model if current one isn't installed
        if (data.models.length > 0) {
          setForm((f) => ({
            ...f,
            model: data.models.includes(f.model) ? f.model : data.models[0]!,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOllamaModels([]);
          setOllamaModelsErr("Cannot reach Ollama. Is it running? (ollama serve)");
        }
      })
      .finally(() => { if (!cancelled) setOllamaModelsLoading(false); });

    return () => { cancelled = true; };
  }, [form.provider, form.ollamaUrl]);

  function setField<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "provider") {
        // Reset model to default for that provider (Ollama may override via discovery)
        next.model = DEFAULT_MODELS[v as string] ?? "";
        next.apiKey = "";
      }
      return next;
    });
  }

  function validatePort() {
    const raw = form.portRaw.trim();
    if (raw === "") { setPortErr(null); return; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setPortErr("Port must be 1–65535");
    } else {
      setPortErr(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const raw = form.portRaw.trim();
    const port = raw === "" ? 25565 : Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setPortErr("Port must be 1–65535");
      return;
    }
    if (!form.host.trim()) { setErr("Server host is required."); return; }
    setBusy(true);
    try {
      const llm: CreateBotPayload["llm"] = {
        provider: form.provider,
        model: form.model.trim(),
        ...(form.provider === "ollama" && form.ollamaUrl ? { baseUrl: form.ollamaUrl } : {}),
        ...(form.provider !== "ollama" && form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      };
      const payload: CreateBotPayload = {
        host: form.host.trim(),
        port,
        username: form.username.trim(),
        auth: form.auth,
        llm,
        cognitiveMode: form.cognitiveMode,
        playstyle: form.playstyle,
        ...(form.version ? { version: form.version } : {}),
      };
      const bot = await api.createBot(payload);
      onCreated(bot);
      onClose();
    } catch (e) {
      setErr(friendlyError(e, "create"));
    } finally {
      setBusy(false);
    }
  }

  const isOllama = form.provider === "ollama";
  const allModes = meta?.cognitiveModes ?? ["deterministic", "lightweight", "balanced", "auto", "deep-reasoning"];
  const allPlaystyles = meta?.playstyles ?? ["companion", "worker", "adventurer", "safe", "auto"];

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
            {/* ── Server ── */}
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
                  autoComplete="off"
                />
              </div>
              <div className="form-field">
                <label>Port <span className="label-optional">optional — defaults to 25565</span></label>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.portRaw}
                  onChange={(e) => { setPortErr(null); setField("portRaw", e.target.value); }}
                  onBlur={validatePort}
                  placeholder=""
                />
                {portErr && <span className="field-error">{portErr}</span>}
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
                Minecraft Version
                <span className="label-optional">optional — auto-detect if blank</span>
              </label>
              <select value={form.version} onChange={(e) => setField("version", e.target.value)}>
                <option value="">Auto-detect</option>
                {(meta?.testedVersions ?? []).map((v) => (
                  <option key={v} value={v}>
                    {v}{v === meta?.latestTested ? " — latest tested" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* ── LLM Provider ── */}
            <div className="form-section-title">LLM Provider</div>

            <div className="form-field">
              <label>Provider</label>
              <select value={form.provider} onChange={(e) => setField("provider", e.target.value)}>
                <option value="ollama">Ollama — local, free, private</option>
                <option value="openai">OpenAI — cloud, requires API key</option>
                <option value="anthropic">Anthropic — cloud, requires API key</option>
              </select>
            </div>

            {/* Ollama URL + model discovery */}
            {isOllama && (
              <div className="form-field">
                <label>
                  Ollama URL
                  <span className="label-optional">default: http://localhost:11434</span>
                </label>
                <input
                  value={form.ollamaUrl}
                  onChange={(e) => setField("ollamaUrl", e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </div>
            )}

            {/* Model — dropdown for Ollama (with auto-discover), text input for cloud */}
            <div className="form-field">
              <label>Model</label>
              {isOllama ? (
                ollamaModelsLoading ? (
                  <div className="model-loading">
                    <span className="loading-dot" />
                    Fetching installed models…
                  </div>
                ) : ollamaModels && ollamaModels.length > 0 ? (
                  <select
                    value={form.model}
                    onChange={(e) => setField("model", e.target.value)}
                  >
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      required
                      value={form.model}
                      onChange={(e) => setField("model", e.target.value)}
                      placeholder="llama3.2"
                    />
                    {ollamaModelsErr && (
                      <span className="field-warn">{ollamaModelsErr}</span>
                    )}
                  </>
                )
              ) : (
                <input
                  required
                  value={form.model}
                  onChange={(e) => setField("model", e.target.value)}
                  placeholder={DEFAULT_MODELS[form.provider] ?? "model name"}
                />
              )}
            </div>

            {/* API key field for cloud providers */}
            {!isOllama && (
              <div className="form-field">
                <label>
                  API Key
                  <span className="label-optional">overrides server env var if set</span>
                </label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setField("apiKey", e.target.value)}
                  placeholder={
                    form.provider === "openai"
                      ? "sk-… (or leave blank to use OPENAI_API_KEY env var)"
                      : "sk-ant-… (or leave blank to use ANTHROPIC_API_KEY env var)"
                  }
                  autoComplete="new-password"
                />
              </div>
            )}

            {/* ── Behaviour ── */}
            <div className="form-section-title">Behaviour</div>

            <div className="form-field">
              <label>Cognitive Mode</label>
              <select
                value={form.cognitiveMode}
                onChange={(e) => setField("cognitiveMode", e.target.value)}
              >
                {allModes.map((m) => (
                  <option key={m} value={m}>
                    {COGNITIVE_LABELS[m] ?? m}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Playstyle</label>
              <select
                value={form.playstyle}
                onChange={(e) => setField("playstyle", e.target.value)}
              >
                {allPlaystyles.map((p) => (
                  <option key={p} value={p}>
                    {PLAYSTYLE_LABELS[p] ?? p}
                  </option>
                ))}
              </select>
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
  bot: BotStatus;
  onError: (msg: string) => void;
  onDisconnect: () => void;
  onReconnect: () => void;
}

function QuickActions({ bot, onError, onDisconnect, onReconnect }: QuickActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, command: string, args?: Record<string, unknown>) {
    setBusy(label);
    try {
      await api.sendCommand(bot.id, command, args);
    } catch (e) {
      onError(friendlyError(e, "command"));
    } finally {
      setBusy(null);
    }
  }

  const actions = [
    { label: "Follow",        command: "follow",        args: undefined },
    { label: "Mine Wood",     command: "mine",          args: { resource: "wood" } },
    { label: "Build Shelter", command: "build",         args: { structure: "simple_shelter" } },
    { label: "Return Home",   command: "return_home",   args: undefined },
    { label: "Report Status", command: "report_status", args: undefined },
  ];

  return (
    <div className="card">
      <div className="card-title">Actions</div>
      <div className="action-group">
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
            Stop Task
          </button>
        </div>
        <div className="action-divider" />
        <div className="action-row">
          <button
            className="btn-action reconnect"
            disabled={busy !== null || bot.connected}
            title={bot.connected ? "Bot is already connected" : "Reconnect to server"}
            onClick={() => { onReconnect(); }}
          >
            Reconnect
          </button>
          <button
            className="btn-action disconnect"
            disabled={busy !== null}
            onClick={() => { setBusy("Disconnect"); onDisconnect(); }}
          >
            {busy === "Disconnect" ? <span className="loading-dot" /> : null}
            Disconnect
          </button>
        </div>
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
  const [showTelemetry, setShowTelemetry] = useState(false);

  return (
    <>
      <div className="card">
        <div className="card-title">Runtime</div>
        <div className="runtime-primary">
          <div className="runtime-task">
            <div className="rt-label">Current Task</div>
            <div className="rt-task-value">{task.current?.type ?? "idle"}</div>
            {task.queueLength > 0 && (
              <div className="rt-queue-hint">+{task.queueLength} queued</div>
            )}
          </div>
          <div className="stat-grid" style={{ flex: 1 }}>
            <div className="stat-item">
              <div className="stat-label">State</div>
              <div className="stat-value">{operationalState}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Zone</div>
              <div className="stat-value">{zone}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Risk</div>
              <div className={`stat-value ${riskColor(riskScore)}`}>{(riskScore * 100).toFixed(0)}%</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Alertness</div>
              <div className="stat-value">{(alertness * 100).toFixed(0)}%</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Mode</div>
              <div className="stat-value">{cognitiveMode}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Playstyle</div>
              <div className="stat-value">{playstyle?.profile ?? "—"}</div>
            </div>
          </div>
        </div>
        {memory.goal && (
          <div className="rt-goal">
            <span className="rt-goal-label">Goal</span>
            <span className="rt-goal-text">{memory.goal}</span>
          </div>
        )}
      </div>

      {(memory.threatCount > 0 || memory.recentEvents.length > 0) && (
        <div className="card">
          <div className="card-title">Memory</div>
          {memory.threatCount > 0 && (
            <div className="rt-threat-banner">
              ⚠ {memory.threatCount} nearby threat{memory.threatCount !== 1 ? "s" : ""}
            </div>
          )}
          {memory.recentEvents.length > 0 && (
            <div className="event-list" style={{ marginTop: memory.threatCount > 0 ? 10 : 0 }}>
              {memory.recentEvents.map((ev, i) => (
                <div key={i} className="event-item">
                  <div className="event-kind">{ev.kind}</div>
                  <div className="event-desc">{ev.description}</div>
                  <div className="event-time">{ev.minsAgo}m ago</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <button
          className="card-title-btn"
          onClick={() => setShowTelemetry((v) => !v)}
          type="button"
        >
          <span className="card-title" style={{ marginBottom: 0 }}>Telemetry</span>
          <span className="collapse-arrow">{showTelemetry ? "▲" : "▼"}</span>
        </button>
        {showTelemetry && (
          <div className="stat-grid" style={{ marginTop: 12 }}>
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
              <div className="stat-label">Threats Seen</div>
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
        )}
      </div>
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
  const [apiDown, setApiDown] = useState(false);
  const [polling, setPolling] = useState(true);

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const botsInFlight = useRef(false);
  const runtimeInFlight = useRef(false);

  const loadBots = useCallback(async () => {
    if (botsInFlight.current || document.hidden) return;
    botsInFlight.current = true;
    try {
      const list = await api.listBots();
      setBots(list);
      setApiDown(false);
      if (selectedIdRef.current && !list.find((b) => b.id === selectedIdRef.current)) {
        setSelectedId(null);
        setRuntime(null);
      }
    } catch {
      setApiDown(true);
    } finally {
      botsInFlight.current = false;
    }
  }, []);

  const loadRuntime = useCallback(async (id: string) => {
    if (runtimeInFlight.current || document.hidden) return;
    runtimeInFlight.current = true;
    try {
      const data = await api.getRuntime(id);
      setRuntime(data);
    } catch {
      setRuntime(null);
    } finally {
      runtimeInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    api.getMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    loadBots();
    if (!polling) return;
    const t = setInterval(loadBots, 3000);
    return () => clearInterval(t);
  }, [loadBots, polling]);

  useEffect(() => {
    if (!selectedId) { setRuntime(null); return; }
    loadRuntime(selectedId);
    if (!polling) return;
    const t = setInterval(() => loadRuntime(selectedId), 2000);
    return () => clearInterval(t);
  }, [selectedId, loadRuntime, polling]);

  // Resume immediately when tab becomes active
  useEffect(() => {
    function onVisible() {
      if (!document.hidden) {
        loadBots();
        if (selectedIdRef.current) loadRuntime(selectedIdRef.current);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadBots, loadRuntime]);

  async function handleDisconnect(id: string) {
    try {
      await api.deleteBot(id);
      if (selectedId === id) { setSelectedId(null); setRuntime(null); }
      await loadBots();
    } catch (e) {
      setCmdError(friendlyError(e, "disconnect"));
    }
  }

  async function handleReconnect(id: string) {
    try {
      await api.reconnectBot(id);
      await loadBots();
    } catch (e) {
      setCmdError(friendlyError(e, "reconnect"));
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
        {apiDown && <span className="api-down-badge">API offline</span>}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setPolling((p) => !p)}
          title={polling ? "Pause auto-refresh" : "Resume auto-refresh"}
        >
          {polling ? "⏸ Live" : "▶ Paused"}
        </button>
      </header>

      <div className="app-body">
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
            {bots.length === 0 && !apiDown && (
              <div style={{ padding: "20px 16px", color: "var(--text-dim)", fontSize: 12 }}>
                No bots connected. Click <strong style={{ color: "var(--text-muted)" }}>+ New Bot</strong> to get started.
              </div>
            )}
            {apiDown && (
              <div className="sidebar-api-warn">
                API server unreachable.<br />Run <code>./start-dev</code> to start it.
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
                  <ConnectionBadge bot={bot} />
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
              <div className="bot-header-row">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2>{selectedBot.username}</h2>
                  <ConnectionBadge bot={selectedBot} />
                </div>
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
              </div>

              <QuickActions
                bot={selectedBot}
                onError={setCmdError}
                onDisconnect={() => handleDisconnect(selectedBot.id)}
                onReconnect={() => handleReconnect(selectedBot.id)}
              />

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
