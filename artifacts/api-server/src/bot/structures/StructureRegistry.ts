import type { Structure } from "../types.js";
import { OakCabin } from "./OakCabin.js";
import { SimpleShelter } from "./SimpleShelter.js";

const registry = new Map<string, Structure>([
  [OakCabin.name, OakCabin],
  [SimpleShelter.name, SimpleShelter],
]);

export function getStructure(name: string): Structure | null {
  return registry.get(name) ?? null;
}

export function listStructures(): Structure[] {
  return Array.from(registry.values());
}

export function registerStructure(structure: Structure) {
  registry.set(structure.name, structure);
}
