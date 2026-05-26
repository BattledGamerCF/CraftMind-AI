export interface NamedLocation {
  name: string;
  position: { x: number; y: number; z: number };
  kind: "base" | "storage" | "farm" | "safe_zone" | "danger_zone" | "resource_site" | "landmark";
  description?: string;
  ownerName?: string;
  notes?: string[];
  discoveredAt: number;
}

export interface ResourceSite {
  resource: string;
  position: { x: number; y: number; z: number };
  estimatedQuantity?: number;
  exhausted: boolean;
  discoveredAt: number;
}

export class SemanticMemory {
  private locations = new Map<string, NamedLocation>();
  private ownership = new Map<string, string>(); // location key -> owner name
  private resourceSites: ResourceSite[] = [];

  rememberLocation(loc: Omit<NamedLocation, "discoveredAt">) {
    const full: NamedLocation = { ...loc, discoveredAt: Date.now() };
    this.locations.set(loc.name, full);
    if (loc.ownerName) this.ownership.set(loc.name, loc.ownerName);
  }

  getLocation(name: string): NamedLocation | null {
    return this.locations.get(name) ?? null;
  }

  listLocations(kind?: NamedLocation["kind"]): NamedLocation[] {
    const all = Array.from(this.locations.values());
    return kind ? all.filter((l) => l.kind === kind) : all;
  }

  forgetLocation(name: string): boolean {
    this.ownership.delete(name);
    return this.locations.delete(name);
  }

  findNearestLocation(pos: { x: number; y: number; z: number }, kind?: NamedLocation["kind"]): NamedLocation | null {
    let best: NamedLocation | null = null;
    let bestDist = Infinity;
    for (const loc of this.locations.values()) {
      if (kind && loc.kind !== kind) continue;
      const dx = loc.position.x - pos.x;
      const dy = loc.position.y - pos.y;
      const dz = loc.position.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < bestDist) { bestDist = dist; best = loc; }
    }
    return best;
  }

  recordResourceSite(site: Omit<ResourceSite, "discoveredAt">) {
    this.resourceSites.push({ ...site, discoveredAt: Date.now() });
    if (this.resourceSites.length > 200) this.resourceSites.shift();
  }

  getResourceSites(resource?: string): ResourceSite[] {
    return resource ? this.resourceSites.filter((s) => s.resource === resource && !s.exhausted) : this.resourceSites;
  }

  markExhausted(position: { x: number; y: number; z: number }) {
    for (const site of this.resourceSites) {
      if (Math.abs(site.position.x - position.x) < 2 && Math.abs(site.position.z - position.z) < 2) {
        site.exhausted = true;
      }
    }
  }

  setHome(position: { x: number; y: number; z: number }) {
    this.rememberLocation({ name: "home", position, kind: "base", description: "Bot home base" });
  }

  getHome(): NamedLocation | null {
    return this.getLocation("home") ?? this.listLocations("base")[0] ?? null;
  }

  snapshot() {
    return {
      locationCount: this.locations.size,
      locations: Array.from(this.locations.values()),
      resourceSiteCount: this.resourceSites.length,
    };
  }
}
