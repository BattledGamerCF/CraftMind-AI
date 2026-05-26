import { ShortTermMemory } from "./ShortTermMemory.js";
import { EpisodicMemory } from "./EpisodicMemory.js";
import { SemanticMemory } from "./SemanticMemory.js";

export class MemoryStore {
  shortTerm = new ShortTermMemory();
  episodic = new EpisodicMemory();
  semantic = new SemanticMemory();

  snapshot() {
    return {
      shortTerm: this.shortTerm.snapshot(),
      episodicCount: this.episodic.count(),
      semantic: this.semantic.snapshot(),
    };
  }
}

export { ShortTermMemory } from "./ShortTermMemory.js";
export { EpisodicMemory } from "./EpisodicMemory.js";
export { SemanticMemory } from "./SemanticMemory.js";
export type { EpisodicEvent, EpisodicEventKind } from "./EpisodicMemory.js";
export type { NamedLocation, ResourceSite } from "./SemanticMemory.js";
