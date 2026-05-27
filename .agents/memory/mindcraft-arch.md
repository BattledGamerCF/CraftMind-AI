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
