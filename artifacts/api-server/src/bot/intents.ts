/**
 * Official Mindcraft intent contract — frozen for v1.
 *
 * USER_INTENTS: the full set of intents that can be submitted by a player
 * (via chat, REST API command, LLM output, or keyword fallback).
 * Planner builders must be registered for every member of this set.
 *
 * SAFETY_INTENTS: intents that are emitted autonomously by FastBrain
 * safety systems only. They are never accepted from player chat or the LLM.
 *
 * KEYWORD_FALLBACK_INTENTS: the subset of USER_INTENTS supported by the
 * deterministic keyword parser when the LLM is unavailable.
 *
 * // EXTENSION POINT: to add a new intent, add it to USER_INTENTS, register
 * // a PlanBuilder in MinecraftBot, and add a keyword pattern in SlowBrain.keywordFallback.
 */

export const USER_INTENTS = [
  "follow_player",   // follow a named player
  "come_here",       // move to the commanding player's position
  "stop",            // cancel all current tasks
  "mine_resource",   // gather a named resource (wood, stone, coal, iron…)
  "build_structure", // construct a named template (oak_cabin, simple_shelter)
  "explore",         // autonomous bounded exploration
  "chat",            // say something in-game without taking an action
  "idle_safe",       // explicit safe-idle (stop and wait near player)
  "return_home",     // navigate to the registered home waypoint
] as const;

export const SAFETY_INTENTS = [
  "engage_hostile",    // attack a nearby hostile — risk system only
  "flee_threat",       // flee a nearby hostile — risk system only
  "eat_food",          // consume food — hunger system only
  "cleanup_inventory", // drop low-value items — inventory system only
  "goto_position",     // hazard-escape movement — hazard watcher only
] as const;

export const KEYWORD_FALLBACK_INTENTS = [
  "follow_player",
  "stop",
  "mine_resource",
  "build_structure",
] as const satisfies ReadonlyArray<(typeof USER_INTENTS)[number]>;

export type UserIntent = (typeof USER_INTENTS)[number];
export type SafetyIntent = (typeof SAFETY_INTENTS)[number];
export type AnyIntent = UserIntent | SafetyIntent;
