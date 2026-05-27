---
name: Mindcraft bot architecture
description: Two-layer bot architecture (deterministic gameplay vs probabilistic LLM) and Phase-2 task-planning stack between them.
---

# Mindcraft bot — architecture

## Hard boundary (do not violate)
- **FastBrain** = deterministic gameplay. State machines, action libraries, perception, arbitration. Runs 24/7. Never calls an LLM.
- **SlowBrain** = probabilistic reasoning. Called *only* on a player chat event addressed to the bot. Returns a structured `LLMIntent`. Never directly drives systems.
- The bridge is `LLMIntent → Planner.buildTasks(intent, ctx) → Task[] → Arbitrator.enqueue(...) → Executors`. Anything that needs to act must enter through the Arbitrator.

**Why:** keeps inference cost low and gameplay debuggable; LLM failure can never wedge the bot.

## Phase-2 stack (between SlowBrain and the systems)
- **Task** (`core/Task.ts`) — priority CRITICAL=100 / HIGH=75 / NORMAL=50 / LOW=25, status pending→ready→running→{succeeded|failed|blocked|cancelled}, prerequisites, retries, timeoutMs, AbortController.
- **Arbitrator** (`core/Arbitrator.ts`) — priority queue + preemption. Higher-priority enqueue cancels current task via AbortSignal. Prereq propagation: prereq in `{failed, cancelled, blocked}` or missing → dependent goes `blocked` with reason. Telemetry hook on completion.
- **Planner** (`core/Planner.ts`) — registry of `PlanBuilder`s keyed by `LLMIntent.intent`. Expose `buildTasks()` (returns Task[]) and `plan()` (returns Plan metadata). Callers wanting to enqueue must use `buildTasks()` — do NOT reach into `builders` map.
- **Perception** (`core/Perception.ts`) — single 500ms tick. Classifies entities (hostile/passive/player), scans hazards (lava/fire). Publish/subscribe snapshot. All reactive watchers (threats, hazards, hunger) live as subscribers in FastBrain and submit CRITICAL/HIGH tasks to the Arbitrator.
- **Memory** (`memory/`) — `ShortTermMemory` (chat ring, recent failures, current goal, threats), `EpisodicMemory` (timestamped events), `SemanticMemory` (named locations, learned facts). Facade in `memory/index.ts`.
- **Telemetry** (`core/Telemetry.ts`) — per-task records, failure summarization, success rates.
- **SharedWorldModel** (`core/SharedWorldModel.ts`) — multi-agent stub. Each bot registers `{id, username, role}` on connect; broadcast bus for shared events. Future: cross-bot task assignment / cooperative planning.

## Reactive watchers (FastBrain.setup)
- **Threat watcher**: hostile within 8 blocks → `engage_hostile` (HIGH) or `flee_threat` (HIGH) when health < 5. Dedupe by `entityId`.
- **Hazard watcher**: lava/fire within 2.5 blocks → CRITICAL `goto_position` away from hazard. Dedupe by checking for in-flight tasks with `metadata.hazard` set, plus 8s debounce. *Critical bug pattern:* if dedupe checks the wrong task type vs what you enqueue, the queue floods every perception tick.
- **Hunger watcher**: food ≤ 14 → HIGH `eat_food`; food ≤ 6 → CRITICAL `eat_food` (non-interruptible). `HungerSystem.start()` is intentionally a no-op — eating is arbitrated, never autonomous, to prevent action conflicts with mining/building/combat.
- **entityHurt (CombatSystem)**: forwards to a callback that submits a task; CombatSystem itself is a pure action library now (no scan loop, no direct state mutation).

## Executor lifecycle
- Every executor receives `(task, signal: AbortSignal)`. Most mineflayer ops (`movement.goto`, `mining.mine`, `building.build`) are not natively abortable, so cancellation is best-effort: the abort handler calls `stopAttacking()` / `bot.pathfinder.stop()` / `bot.clearControlStates()`. Treat cancellation as cooperative, not instantaneous.
- `follow_player` intentionally never naturally completes — it runs until preempted, cancelled, or times out. That's the policy.
- `ensure_inventory` known limitation: maps items → mining resource (`planks → wood`). No crafting layer. If mining doesn't yield the literal item name (e.g. need `oak_planks` but mined `oak_log`), it logs and continues; downstream `build_structure` may fail with unmet materials. Document this when adding new structures.

## Cognition Pipeline (Player Input → Intent)

```
Player chat
  → MinecraftBot.handleChat
  → CognitiveRouter.route()          ← all mode/profile/budget decisions here
  → IntentCache.get()                ← skip LLM for repeated inputs
  → CognitiveRouter.parseDeterministic()  ← fast path for keyword commands
  → SlowBrain.processChat(decision)  ← LLM path, uses decision.promptProfile + memoryBudget
  → CanonicalIntent (confidence, source)
  → confidence gating                ← < 0.2 ignore, 0.2-0.4 fallback, ≥ 0.4 submit
  → FastBrain.submitIntent()         ← Planner → Arbitrator → Executors
```

**CognitiveRouter** (`bot/cognition/CognitiveRouter.ts`) is the single authority for:
- Resolving effective mode (including auto heuristics)
- Hysteresis: higher-urgency modes override immediately; downgrade only after 5s cooldown
- Prompt profile selection by state (combat→combat, building→builder, else by mode)
- Memory budget and token budget per mode
- deterministicAllowed, fallbackStrategy, reasoningDepth

SlowBrain is a consumer — it has no mode logic. It accepts `CognitiveDecision` and calls `getPromptProfile(decision.promptProfile)`.

**CanonicalIntent** extends `LLMIntent` with `confidence: number` and `source: "deterministic"|"llm"|"cache"`. The Planner and below see it as a plain LLMIntent (duck-typed).

**IntentCache** (`bot/cognition/IntentCache.ts`): normalized-key LRU (200 entries). TTL: deterministic=120s, LLM=30s. Only caches confidence ≥ 0.75. Cleared on bot destroy.

**CognitionTelemetry** (`bot/cognition/CognitionTelemetry.ts`): mode frequency, prompt tokens, routing latency, confidence distribution, cache hits, deterministic bypass count. Exposed at `GET /api/bots/:id/cognition`.

**PromptProfiles** (`bot/cognition/PromptProfiles.ts`): 7 focused profiles (lightweight, balanced, combat, planning, social, builder, deep-reasoning). Combat profile loads no building context; planning/builder profiles load no combat-specific rules.

## Phase 3 additions (gameplay quality + planner stability)

### RiskAssessor (`bot/systems/RiskAssessor.ts`)
- Computes `RiskScore { value 0–1, reasons[], shouldRetreat, shouldAvoidCombat, shouldStayNear }`
- Inputs: perception snap (health/food/hostiles), InventorySystem (armor check), timeOfDay
- Used every perception tick in FastBrain: gates combat (flee vs attack), proactive food threshold (14→16 under stress), auto-retreat home when risk ≥ 0.70 + task is LOW priority

### TrustSystem (`bot/social/TrustSystem.ts`)
- Per-player `PlayerTrust { score 0–100, level, interactions, commands, hostile/helpful events }`
- Incremented in MinecraftBot.handleChat (any message +1) and submitIntent (command +2)
- Exposed at `GET /api/bots/:id/trust`
- `shouldPrioritize(name)` → score ≥ 60 or level ≥ trusted

### Planner stability
- **Arbitrator dedup**: `enqueue()` now skips NORMAL/LOW tasks when identical type+target already pending/ready/running
- **Intent failure throttle** in FastBrain: `intentFailures` Map tracks per-TaskType failures; after 3 failures → 60s cooldown, bot refuses that intent and says so
- Both reset on bot destroy

### Idle executor improvements (`executors/index.ts` idle case)
- Replaced 5s sleep with probabilistic behavior selection (picks 2 of 3):
  1. Glance around (random yaw lookAt)
  2. Toss trash if inventory full
  3. Drift toward home if distance > 24 blocks
- 3–5s natural pause at end; fully abortable throughout

### New REST endpoint
- `GET /api/bots/:id/trust` — returns trust snapshot sorted by score

## Phase 3+ additions (persistence, crafting, long-session stability)

### PersistenceManager (`bot/PersistenceManager.ts`)
- Saves JSON to `$HOME/.mindcraft/bots/{botId}.json` — survives process restarts
- State: `{ version:1, home, cognitiveMode, currentGoal, semanticLocations[], trustPlayers[] }`
- Wire: loaded on spawn (after fastBrain.setup), autosave every 60s via setInterval, flush on destroy
- `scheduleSave(state, 5000)` debounces rapid updates; `flush()` writes immediately

### CraftingSystem (`bot/systems/CraftingSystem.ts`)
- Wraps mineflayer `bot.recipesFor` + `bot.craft` with `(bot as unknown)` casts (Registry type mismatch)
- `craftItem(name, count)` — tries 2x2 first, falls back to nearby crafting table (4-block radius)
- `craftPlanks()` — detects log type in inventory; `craftSticks()`, `craftTorches()` wrappers
- Added to `ExecutorDeps.crafting` and wired through `FastBrain.crafting` → `createDefaultExecutors`

### craft_item executor + craft_tools plan
- `craft_item` TaskType + executor — dispatches to craftPlanks/craftSticks/craftTorches helpers or raw craftItem
- `craft_tools` plan: [planks → sticks → wooden_pickaxe, wooden_sword] with prerequisite chaining by task ID
- `craft_tools` intent registered in router (keyword: "craft tools/make tools/craft pickaxe"), PromptProfiles INTENTS, and plans

### Explore dedup
- Module-level `exploredCells: Map<cellKey, expireAt>` in executors/index.ts (32-block cells, 10min TTL)
- `markExplored()` + self-pruning; explore executor tries 6 random angles, picks first unvisited
- Also skips entire explore task if `inventory.isFull()`

### Long-session stability caps
- SemanticMemory: cap at 100 locations, evict oldest (home exempt)
- SemanticMemory: `recordWaypoint(name, pos, desc)` helper alias for kind="landmark"
- TrustSystem: cap at 50 players, evict lowest-scoring non-owner on overflow
- TrustSystem: `restore(players[])` method for persistence reload

## Integration Hardening (Phase 9)

### Audit outcome — all systems already compliant
- Risk: only enqueues CRITICAL/HIGH safety-class tasks (combat, eat, hazard-escape, retreat). No non-safety enqueues. ✓
- Playstyle: `resolve()` returns weights only; nothing in the hot path enqueues based on playstyle alone. ✓
- Habit: `getPreferredIdleSpot()` returns Vec3|null suggestion; idle executor uses as a target hint, not a command. ✓
- Queue eviction: already filtered to `priority === "LOW" || priority === "NORMAL"` only. ✓

### Conflict detection tags (consistent across all fallback paths)
- `[conflict] subsystems:"planner→idle"` — planner threw, safe idle returned
- `[conflict] subsystems:"llm→keyword"` — LLM failed, keyword intent produced
- `[conflict] subsystems:"queue→evict"` — queue at ceiling, LOW/NORMAL dropped
- `[conflict] subsystems:"queue→drop"` — queue full of CRITICAL/HIGH, incoming tasks dropped
- All are WARN (conflict) or INFO (keyword fallback) — never ERROR

### Debug tick trace (`FastBrain`, gated on `config.debug.enabled`)
- Emits single DEBUG log per perception cycle tagged `[tick]`
- Fields: `zone`, `risk` (2dp), `state` (operationalState), `playstyle` (via `.getName()`), `task`, `taskPriority`
- Zero cost in production (guarded by `config.debug.enabled` flag)
- `PlaystyleProfile.getName()` is the correct accessor — `.profile` does not exist

## Stabilization & Packaging (Phase 8)

### `src/bot/presets.ts` — 4 exported bot presets
- `minimal_companion`: lightweight/companion/no-combat — safe co-op
- `stable_worker`: balanced/worker/combat — mining+building server assistant
- `safe_observer`: lightweight/safe/no-combat — monitor/tour-guide
- `explorer_light`: balanced/adventurer/combat — exploration+resources
- Type is `BotPreset` (local interface — auth, llm, behavior, cognitiveMode, playstyle)
- Spread into POST /api/bots body; override host/port/username

### `SlowBrain` — keyword fallback on LLM failure
- `keywordFallback(playerName, message)` — called from catch block instead of `return null`
- Matches: follow/come → follow_player; stop/halt/wait → stop; mine/dig/gather → mine_resource; build/construct → build_structure
- Returns `{ source: "deterministic" }` intent; works with no Ollama/API key running

### Task queue ceiling (`FastBrain.submitIntent`)
- Before `enqueueMany`: checks `arbitrator.getQueue().length >= config.safety.maxTasksInQueue`
- Evicts LOW/NORMAL pending tasks to make room; if still full → returns `{ planId: "queue_full" }`
- Controlled by `config.safety.maxTasksInQueue` (`MINDCRAFT_MAX_TASKS=10`)
- FastBrain now imports `config` from `"../config.js"` (was missing, required adding)

### README.md (root) — final practical pass
- First Run section (5-step zero-config path)
- Preset table (4 rows) with REST body example
- Debug mode section
- Complete env var table (includes LLM_MAX_CALLS_PER_MINUTE, MINDCRAFT_MAX_TASKS, MINDCRAFT_DEBUG)
- Troubleshooting quick table (10 symptom→fix rows)
- Performance tuning knobs table
- /runtime response shape example

## Production Hardening (Phase 7)

### Debug mode (`config.debug.enabled` / `MINDCRAFT_DEBUG=true`)
- HumanizationSystem: fixed delays instead of randomBetween (15s idle, 8s look)
- HumanizationSystem: `doIdleBehavior()` returns immediately (no ambient noise)
- Config reads once at startup — not re-read per tick; hot-reload is not supported

### Planner failure fallback (`FastBrain.submitIntent`)
- `planner.buildTasks()` wrapped in try/catch
- On catch: logs WARN, returns `{ planId: "planner_error", taskCount: 0 }` (safe, no crash)

### Risk score caching (`FastBrain`)
- `private lastRiskScore = 0` — updated every perception tick after `riskAssessor.assess()`
- `getLastRiskScore(): number` — public accessor for runtime endpoint
- `getCurrentZone()` — thin accessor over private `zoneClassifier.getCached()`

### LLM rate limiting (`SlowBrain`)
- `callsThisMinute` + `minuteWindowStart` — sliding 60s window
- Limit: `config.safety.llmMaxCallsPerMinute` (default 20, env `LLM_MAX_CALLS_PER_MINUTE`)
- Over-limit: logs DEBUG, returns null (no LLM call made)

### `GET /api/bots/:id/runtime`
- Single-call snapshot: task, zone, operationalState, cognitiveMode, playstyle, riskScore, alertness, memory summary (goal/threatCount/episodicCount/recentEvents×5/waypointCount), telemetry stats
- `mem.shortTerm.snapshot()` field is `nearbyThreats`, NOT `threats`

### Startup health checks (`index.ts → runHealthChecks()`)
- Runs async after listen — never blocks startup
- Check 1: mkdir + access persistence.botsDir — logs INFO ✓ or WARN ✗
- Check 2: GET `{ollamaUrl}/api/tags` with 3s AbortSignal.timeout — logs INFO ✓ or INFO ✗
- Ollama offline is INFO (not WARN) — expected in cloud/API-key-only setups

## Public Alpha Readiness (Phase 6)

### `src/config.ts` — centralized config
- Single export `config` — reads all env vars with defaults
- `config.server`: nodeEnv, logLevel
- `config.persistence`: dataDir (`MINDCRAFT_DATA_DIR` or `~/.mindcraft`), botsDir, enabled flag
- `config.llm`: defaultProvider/model/ollamaBaseUrl (`OLLAMA_BASE_URL`), openaiApiKey, anthropicApiKey, requestTimeoutMs (`LLM_TIMEOUT_MS`)
- `config.bots`: maxConcurrent (`MINDCRAFT_MAX_BOTS`=10), connectionTimeoutMs, defaultChatCooldownMs, defaultCognitiveMode, defaultPlaystyle
- `config.safety`: maxWaypointsPerBot=50, maxEpisodicEventsPerBot=500, maxChatHistoryPerBot=200, maxHabitIdleSpotsPerBot=25, autonomousWanderMaxBlocks=200

### `src/index.ts` — startup banner
- Logs structured summary on listen: port, env, providers, maxBots, dataDir, persistence
- Warns if no cloud keys: "No cloud API keys set — Ollama only"
- Uses `process.exit(1)` with logger.error (not throw) for graceful failure messaging

### `bot/llm/ProviderFactory.ts` — validation
- openai: checks `config.apiKey ?? process.env["OPENAI_API_KEY"]`; throws actionable error if missing
- anthropic: same pattern; throws actionable error if missing
- default case: includes valid options list in error message
- Provider factories now receive apiKey from env automatically when not in bot config

### `bot/SlowBrain.ts` — degradation handling
- `consecutiveFailures` counter + `providerDegradedLoggedAt` timestamp
- After 3 failures: logs WARN with provider name, model, count, and remediation steps for Ollama vs cloud
- 60s cooldown on the degraded log to suppress spam
- Single failures log at DEBUG (not ERROR)
- Success resets `consecutiveFailures` to 0

### `README.md` — public quickstart
- Quickstart: prerequisites, install, configure, start
- Env var table with all variables, defaults, and descriptions
- LLM provider setup for Ollama, OpenAI, Anthropic with example bot configs
- API reference with curl examples for all endpoints
- In-game command reference
- Architecture diagram (text)
- Troubleshooting: Ollama offline, missing API key, auth issues, persistence

## Behavioral Continuity & Habit Formation (Phase 5)

### HabitStore (`bot/core/HabitStore.ts`)
- Idle-spot grid: 4-block cells; max 25 entries; evicts lowest-weight on overflow
- `recordIdlePosition(pos)` / `getPreferredIdleSpot(near, maxDist)` — weighted-random (needs weight > 2 to be eligible)
- `recordDangerArea(pos, durationMs=90min)` / `isDangerousArea(x, z, radius=24)` — TTL-based, auto-prunes
- `recordPlayerInteraction(name)` / `getPlayerFamiliarity(name)` — saturates at 20 interactions → 1.0
- `getLocationFamiliarity(pos, radius=15)` — 0–1, saturates at cumulative weight 10 nearby
- `decay(factor=0.93)` — multiply all counters; remove below threshold (0.5 idle, 0.3 player); called every 60s in prune interval
- `serialize()` / `restore(data)` — habits saved to PersistenceManager, restored on bot reconnect
- Danger marks restore with future-expiry filter (stale marks dropped on restore)

### Integration points
- **FastBrain.habits** — public field; created in constructor; passed to `createDefaultExecutors()` deps
- **Chat handler** → `habits.recordPlayerInteraction(username)` on every chat
- **Prune interval** → `habits.decay()` every 60s alongside `arbitrator.pruneCompleted()`
- **Zone update (10s)** → `habits.getLocationFamiliarity(pos)` → `humanization.setFamiliarity(level)`
- **MinecraftBot.buildPersistedState** → `habits.serialize()` in save; `habits.restore()` on load

### HumanizationSystem familiarity
- `setFamiliarity(level)` — stores `familiarityLevel` (0–1)
- `scheduleLookAround()` applies `famMult = familiarityLevel > 0.6 ? 1.5 : 1` — familiar areas scan less

### Idle executor habit wiring
- 30% chance before idle behaviors: drift to `getPreferredIdleSpot(pos, 20)` if known and > 2 blocks away
- After idle behaviors: `recordIdlePosition(current pos)` — builds up preference over time

### Explore executor habit wiring
- Loop expanded to 8 attempts; each candidate checked against `isDangerousArea(x, z)` — avoids known danger zones
- Fallback on attempt 7 takes last candidate regardless

### PersistenceManager `PersistedState`
- Added optional `habits?: { idleSpots, dangerMarks, players }` field — inline type matching `SerializedHabits`

## Environmental Awareness (Phase 4)

### ZoneClassifier (`bot/core/ZoneClassifier.ts`)
- `ZoneType`: "home" | "storage" | "workshop" | "mine" | "farm" | "danger" | "open"
- `classify(homePos?, dangerWaypoints?)` — cached 15s; call `invalidate()` after teleport
- Priority order: home radius (18 blocks) → danger waypoint (12 blocks) → storage (chest/barrel within 7) → workshop (crafting/furnace/anvil within 5) → farm (farmland/crops within 9) → mine (y < 50 + skyLight = 0 ten blocks up) → open
- Block matching uses `bot.findBlock({ matching: (b) => predicate(b.name) })` — no registry needed
- Wire: `FastBrain` creates `ZoneClassifier`, runs `updateZone()` every 10s, pushes result to `HumanizationSystem.setZone()`

### Explosion event handling (FastBrain)
- `bot.on("explosion", ...)` is not in mineflayer's `BotEvents` typings — must cast: `(this.bot as unknown as { on(e: string, fn: ...): void }).on("explosion", ...)`
- Within 30 blocks: `setAlertness(level, 30_000)` + `lookAtEvent(pos)` + episodic `world_event` record
- alertLevel = `max(0.4, 1 - dist/30)`

### HumanizationSystem zone + alertness
- `setZone(zone)` — stored as `currentZone`; applied in `scheduleIdleBehavior()` as a multiplier
  - storage/workshop: 1.8× idle delay; mine/danger: 3×; home: 0.8×
- `setAlertness(level, durationMs)` — auto-decays on timer; takes max of existing vs new
- `getAlertness()` — readable for external decisions
- `alertness > 0.7` → idle suppressed; `alertness > 0.5` → look cooldown drops to 1500ms
- `suppressMotion = zone === "storage" || zone === "workshop"` → smallStep/jump skipped
- All alertness/zone timers cleared in `stop()`

### Spatial etiquette (executors/index.ts — idle executor)
- After idle behaviors run, checks `bot.blockAt(pos.offset(0, -1, 0))` (block below feet)
- Important blocks: `*_bed`, `*chest*`, `barrel`, `crafting_table`, `furnace`, `blast_furnace`, `farmland`, `*shulker_box`, `smoker`
- If standing on one: `movement.goto(pos + 2 blocks in random direction)` — wrapped in `.catch()`
- Runs before the natural pause, only when not signal.aborted

### EpisodicMemory additions
- `recentCount(kind, windowMs)` — count events of kind in the window
- `hasRecent(kind, windowMs)` — boolean any-match

## Behavioral Personality & Humanization Refinement

### PlaystyleProfile (`bot/playstyle/PlaystyleProfile.ts`)
- `PlaystyleName`: companion | worker | adventurer | safe | auto
- `PlaystyleWeights`: 10 float fields (followDistance, explorationRange, autonomyLevel, riskTolerance, idleFrequency, socialFrequency, taskPersistence, combatAggressiveness, homeReturnBias, comfortRadius)
- Fixed profiles are static; `auto` blends worker→safe (risk), worker→companion (players nearby), worker→adventurer (exploring), all→safe (night)
- `PlaystyleProfile.resolve(ctx?)` → recomputes weights for auto every perception tick; fixed profiles return cached
- Set via `POST /api/bots/:id/config playstyle` at creation or `PATCH /api/bots/:id/playstyle { profile }` at runtime

### OperationalState (`computeOperationalState` in PlaystyleProfile.ts)
- 4 states: stressed (risk ≥ 0.6) | curious (explore task) | focused (non-idle task) | relaxed (default)
- Computed every perception tick in FastBrain; pushed to HumanizationSystem via `setOperationalState()`
- Exposed via `GET /api/bots/:id/playstyle` as `operationalState`

### HumanizationSystem refinements
- Idle timer multiplier: stressed=3x, focused=2x, curious=0.7x, relaxed=1x
- Look timer multiplier: stressed=0.5x (anxious scanning), focused=2.5x (rare)
- Min look cooldown: 8s when focused, 4s otherwise — prevents look spam
- Jump suppressed unless state=relaxed
- Anti-pacing: `smallStep()` checks if bot moved < 2 blocks in last 10s; if not, skips to prevent in-place pacing

### SocialSystem chat dedup
- `sentMessages: Map<normalizedKey, lastSentAt>` — 30s dedup window
- Normalized: lowercase, strip punctuation, first 40 chars
- Auto-pruned when > 30 entries; prevents identical acknowledgements spamming chat

### Playstyle in executors
- `ExecutorDeps.playstyle?: PlaystyleWeights` — resolved weights passed at executor creation time
- `follow_player`: uses `playstyle.followDistance` (default 3) passed to `MovementSystem.followPlayer(name, dist)` — GoalFollow now respects dynamic distance
- `explore`: scales max range by `playstyle.explorationRange` multiplier
- `idle`: gates ambient behaviors by `playstyle.idleFrequency` probability check

### New endpoints
- `GET /api/bots/:id/playstyle` → `{ name, weights, operationalState }`
- `PATCH /api/bots/:id/playstyle { profile }` → switches named profile; validates against set

## Cognitive Economy Modes
Controlled by `CognitiveMode` on `BotConfig` / `SlowBrain`. Switch at runtime via `PATCH /api/bots/:id/mode`.

| Mode | Behavior |
|---|---|
| `deterministic` | No LLM. `parseLocalIntent()` in `MinecraftBot` maps keywords → `LLMIntent`. |
| `lightweight` | Compact system prompt, history trimmed to 4, low max_tokens (advisory). |
| `balanced` | Default. Full prompt, 6-message history. |
| `auto` | `selectAutoMode()` in `SlowBrain` picks: combat/low-health → lightweight; long/complex message → deep-reasoning; simple keyword → lightweight; else balanced. |
| `deep-reasoning` | Extended prompt, 10-message history, inventory context doubled. |

**Hard rule:** no mode bypasses Planner → Arbitrator → Executor. Mode only affects whether/how SlowBrain produces an `LLMIntent`. FastBrain and Arbitrator are always deterministic.

**Extension point:** `getModeConfig()` returns `maxTokens` — wired to providers when they support it (currently `void`-dropped; add third arg to `LLMProvider.chat` when needed).

## Externals & gotchas
- `mineflayer` + `mineflayer-pathfinder` must be esbuild externals — they have native deps and dynamic requires that can't be bundled.
- Bot only responds in chat when its username is mentioned or message starts with `!` / `.` / `@all`.
- Always run `pnpm run typecheck` before assuming the build is good — the build script does not type-check.

## State derivation
`FastBrain.state: BotState` is derived from the *currently-running task's type*, not stored. e.g. `mine_resource → "mining"`, `engage_hostile → "combat"`, no current task → `"idle"`. Don't write state directly — change tasks.

## REST visibility endpoints
- `/api/bots/:id/tasks` — current + queue + all
- `/api/bots/:id/perception` — last snapshot
- `/api/bots/:id/memory` — short/episodic/semantic
- `/api/bots/:id/telemetry` — stats + recent records + failure summary
- `/api/swarm` — registered multi-agent bots
- `POST /api/bots/:id/tasks/cancel-all`
