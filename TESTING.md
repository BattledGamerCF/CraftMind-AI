# Mindcraft Testing Guide

Field tests for a real Minecraft server. Each test starts from a clean bot connection unless otherwise noted.

**Before you begin:** Start a Minecraft Java Edition server and the Mindcraft runtime.

```bash
# Start Mindcraft (all-in-one)
node launcher.mjs         # Linux / macOS
Mindcraft.bat             # Windows (double-click)
```

The dashboard opens at `http://localhost:3000/` when both services are ready.

---

## Test 1 — First Launch

**Setup**
- Clean clone. No `.env` file present.
- Run `node launcher.mjs`.

**Steps**
1. Observe terminal output.
2. Observe browser.

**Expected result**
- Terminal prints port numbers, then "Mindcraft is running!".
- Browser opens automatically to `http://localhost:3000/dashboard/`.
- Welcome modal appears with 3-step guide.
- Dashboard header shows "API offline" badge (no bot connected yet — normal).

**Pass criteria**
- No crash or unhandled error on startup.
- `.env` is auto-created from `.env.example`.
- Welcome modal appears on first visit and can be dismissed.
- Dashboard shows "API server unreachable" prompt in the sidebar.

---

## Test 2 — Bot Creation

**Setup**
- Mindcraft running (API + dashboard).
- Minecraft server running in offline mode (`online-mode=false`).
- Ollama running: `ollama serve` (model `llama3.2` pulled).

**Steps**
1. Click **+ New Bot** in the dashboard.
2. Fill in: Host `localhost`, Port `25565`, Bot Username `MindBot`.
3. Provider: `Ollama`. Model auto-populates — select `llama3.2`.
4. Leave Cognitive Mode and Playstyle at defaults.
5. Click **Connect Bot**.

**Expected result**
- Spinner visible for 1–3 seconds.
- Bot appears in the sidebar with status `idle` or `exploring`.
- Runtime panel appears on the right showing health, food, position, and zone.

**Pass criteria**
- No error banner.
- `GET /api/bots` returns the bot with `connected: true`.
- Bot is visible as a player in the Minecraft world.

---

## Test 3 — Minecraft Connection Test

**Setup**
- A bot already connected (Test 2 complete).

**Steps**
1. In Minecraft, open a chat window and type:
   ```
   MindBot hello
   ```
2. Watch the in-game chat and the dashboard **Runtime** panel.

**Expected result**
- Bot replies in chat within 3–8 seconds (LLM call time).
- Dashboard chat history in the Runtime panel shows the exchange.

**Pass criteria**
- Bot responds with natural language.
- If Ollama is slow, response arrives within 30 seconds.
- No error logged in the **Logs** tab.

---

## Test 4 — Follow Command

**Setup**
- Bot connected and in the same world as a player named `Steve` (your in-game name).

**Steps**
1. In Minecraft chat:
   ```
   MindBot follow me
   ```
2. Walk away from the bot.

**Expected result**
- Bot starts moving toward you within 2–5 seconds.
- Dashboard Runtime panel shows task: `follow_player`.
- Bot maintains ~3 block follow distance while you move.

**Pass criteria**
- Bot physically moves in-game.
- `task.current.type` in `/api/bots/:id/runtime` is `follow_player`.
- Bot stops when you run:
  ```
  MindBot stop
  ```

---

## Test 5 — Mine Command

**Setup**
- Bot connected.
- Trees (oak logs) within 20 blocks of the bot's starting position.

**Steps**
1. In Minecraft chat:
   ```
   MindBot mine some wood
   ```

**Expected result**
- Bot navigates to the nearest tree and begins breaking logs.
- Dashboard shows task: `mine_resource`.
- After ~30 seconds the bot has collected some logs and returns to idle.

**Pass criteria**
- Bot physically mines blocks in-game.
- `task.current.type` is `mine_resource`.
- No pathfinding error in the Logs tab.
- If no trees are nearby, bot logs a warning and returns to idle cleanly.

---

## Test 6 — Build Command

**Setup**
- Bot connected.
- Flat area with at least a 5×5 clear space near the bot.
- Bot must have wood in its inventory (run Mine test first, or give items via `/give`).

**Steps**
1. In Minecraft chat:
   ```
   MindBot build a shelter
   ```

**Expected result**
- Bot navigates to the build site and places blocks.
- Dashboard shows task: `build_structure`.
- A `simple_shelter` (small structure) appears in-game.

**Pass criteria**
- At least some blocks are placed.
- Task completes without an unhandled exception in the Logs tab.
- If not enough materials, bot logs a warning and returns to idle cleanly.

---

## Test 7 — Home System Test

**Setup**
- Bot connected.
- Stand near the bot in-game so it knows your position.

**Steps**
1. Set a home waypoint via chat:
   ```
   MindBot return home
   ```
   (First run: bot will note there is no home and idle.)
2. Walk the bot somewhere via the **Follow** command, then use the dashboard **Return Home** quick action.

**Expected result**
- On first run: bot stays in place (no home set yet).
- After setting a home (the bot saves its spawn location automatically on first connect), the bot navigates back to that position.

**Pass criteria**
- After `return home`, the Runtime panel shows task `return_home`.
- Bot physically moves toward the home waypoint.
- If no home is set, the Logs panel shows an info message rather than a crash.

---

## Test 8 — Persistence Test

**Setup**
- Bot connected and actively running for at least 2 minutes.
- Note the bot's current position and cognitive mode.

**Steps**
1. Stop the Mindcraft server (`Ctrl+C` in the terminal).
2. Wait 5 seconds.
3. Start Mindcraft again (`node launcher.mjs` or `./start-dev`).
4. Create a new bot with the **same username and server** (same host/port).

**Expected result**
- API logs show: `PersistenceManager: state restored`.
- Bot restores its cognitive mode, waypoints, and trust levels.
- Dashboard Runtime panel shows previous memory entries.

**Pass criteria**
- Log line `state restored` appears after reconnect.
- Bot does not start from a blank slate (trust system shows existing players).
- Data directory `~/.mindcraft/bots/` contains a `.json` file for the bot.

---

## Test 9 — LLM Fallback Test

**Setup**
- Bot connected.
- Stop Ollama: `pkill ollama` or close the Ollama process.

**Steps**
1. In Minecraft chat:
   ```
   MindBot follow me
   ```
2. Wait for the bot to respond (or not).

**Expected result**
- Bot still begins following you using the keyword fallback (no LLM needed for `follow`).
- Logs panel shows a warning about Ollama being unreachable — not a crash.
- `MindBot mine some wood` also works via fallback.

**Pass criteria**
- Bot responds to `follow`, `stop`, `mine`, `build` commands without Ollama running.
- Natural language requests (e.g. "MindBot what are you doing") produce no reply (expected — LLM unavailable).
- No ERROR-level log entries; only WARN or INFO about Ollama being offline.
- After restarting Ollama, full responses resume without restarting the bot.

---

## Test 10 — Failure Recovery Test

**Setup**
- Bot connected.

**Steps**
1. Send the bot to mine something far away:
   ```
   MindBot mine some iron
   ```
2. While the bot is pathing, teleport it to the middle of an ocean or deep pit (or build a wall around it in creative mode).
3. Observe behavior.

**Expected result**
- Bot detects the pathfinding failure and aborts the current task.
- Bot returns to idle state without hanging or crashing.
- Dashboard Runtime panel reflects the task cancellation.
- Logs panel shows a warning (not an error crash) about pathfinding failure.

**Pass criteria**
- `task.current` in `/api/bots/:id/runtime` returns to `null` or a new idle task within 60 seconds.
- No unhandled exception in the Logs tab.
- Bot is still responsive to new commands after recovery.
- API server process remains running (`GET /api/healthz` returns 200).
