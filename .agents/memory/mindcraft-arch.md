---
name: Mindcraft bot architecture
description: Key decisions for the Minecraft AI companion backend built in artifacts/api-server
---

## Rule
mineflayer, mineflayer-pathfinder, vec3, and prismarine-* must all be listed in the esbuild `external` array in `artifacts/api-server/build.mjs`. They have native modules and dynamic requires that cannot be bundled.

**Why:** esbuild fails or produces broken output when trying to bundle these packages. They load fine from node_modules at runtime.

**How to apply:** Any new Minecraft-ecosystem npm package added as a dependency should be added to the `external` list in build.mjs before testing.

## Rule
SlowBrain is called only on player chat events, never in a polling loop.

**Why:** Keeping LLM calls event-driven prevents inference cost from scaling with uptime. A single bot responding to 20 messages/hour costs vastly less than one called every few seconds.

**How to apply:** If adding new SlowBrain triggers, use event listeners (bot.on / setTimeout-once) not setInterval.

## Rule
The LLM must return a JSON object with `{ intent, target?, chat?, params? }`. Never free-form text.

**Why:** Structured output avoids command parsing failures with smaller local models (5–7B). The SYSTEM_PROMPT in SlowBrain.ts enforces this format.

**How to apply:** When changing the intent schema, update both the SYSTEM_PROMPT in SlowBrain.ts and the LLMIntent type in types.ts together.

## Rule
prismarine-entity and prismarine-block types are not directly importable — use inline minimal types + `as unknown as` casts at mineflayer call sites.

**Why:** These packages declare types locally without exporting them. Importing `Entity` from `mineflayer` fails; importing from `prismarine-entity` requires that package in devDeps with its own type quirks.

**How to apply:** Define minimal local type shapes, then cast to `Parameters<Bot["method"]>[0]` where mineflayer methods require the full type.
