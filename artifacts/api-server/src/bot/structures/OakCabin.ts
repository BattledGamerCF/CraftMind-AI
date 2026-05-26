import type { Structure } from "../types.js";

function log(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "oak_log" };
}
function plank(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "oak_planks" };
}
function glass(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "glass" };
}
function slab(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "oak_slab" };
}
function door(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "oak_door" };
}
function torch(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "torch" };
}
function stair(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "oak_stairs" };
}
function cobble(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "cobblestone" };
}

export const OakCabin: Structure = {
  name: "oak_cabin",
  displayName: "Oak Cabin",
  width: 7,
  height: 5,
  depth: 7,
  blocks: [
    // --- Floor (y=0) ---
    ...([0, 1, 2, 3, 4, 5, 6].flatMap((x) =>
      [0, 1, 2, 3, 4, 5, 6].map((z) => plank(x, 0, z))
    )),

    // --- Walls y=1 ---
    // South wall (z=0)
    log(0, 1, 0), plank(1, 1, 0), plank(2, 1, 0), door(3, 1, 0), plank(4, 1, 0), plank(5, 1, 0), log(6, 1, 0),
    // North wall (z=6)
    log(0, 1, 6), plank(1, 1, 6), plank(2, 1, 6), plank(3, 1, 6), plank(4, 1, 6), plank(5, 1, 6), log(6, 1, 6),
    // West wall (x=0)
    plank(0, 1, 1), glass(0, 1, 2), plank(0, 1, 3), glass(0, 1, 4), plank(0, 1, 5),
    // East wall (x=6)
    plank(6, 1, 1), glass(6, 1, 2), plank(6, 1, 3), glass(6, 1, 4), plank(6, 1, 5),

    // --- Walls y=2 ---
    log(0, 2, 0), plank(1, 2, 0), glass(2, 2, 0), plank(3, 2, 0), glass(4, 2, 0), plank(5, 2, 0), log(6, 2, 0),
    log(0, 2, 6), plank(1, 2, 6), plank(2, 2, 6), plank(3, 2, 6), plank(4, 2, 6), plank(5, 2, 6), log(6, 2, 6),
    plank(0, 2, 1), plank(0, 2, 2), plank(0, 2, 3), plank(0, 2, 4), plank(0, 2, 5),
    plank(6, 2, 1), plank(6, 2, 2), plank(6, 2, 3), plank(6, 2, 4), plank(6, 2, 5),

    // --- Gable / Roof base y=3 ---
    log(0, 3, 0), plank(1, 3, 0), plank(2, 3, 0), plank(3, 3, 0), plank(4, 3, 0), plank(5, 3, 0), log(6, 3, 0),
    log(0, 3, 6), plank(1, 3, 6), plank(2, 3, 6), plank(3, 3, 6), plank(4, 3, 6), plank(5, 3, 6), log(6, 3, 6),
    plank(0, 3, 1), plank(0, 3, 2), plank(0, 3, 3), plank(0, 3, 4), plank(0, 3, 5),
    plank(6, 3, 1), plank(6, 3, 2), plank(6, 3, 3), plank(6, 3, 4), plank(6, 3, 5),

    // --- Roof (slabs and stairs) ---
    stair(0, 4, 0), slab(1, 4, 0), slab(2, 4, 0), slab(3, 4, 0), slab(4, 4, 0), slab(5, 4, 0), stair(6, 4, 0),
    stair(0, 4, 1), slab(1, 4, 1), slab(2, 4, 1), slab(3, 4, 1), slab(4, 4, 1), slab(5, 4, 1), stair(6, 4, 1),
    stair(0, 4, 2), slab(1, 4, 2), slab(2, 4, 2), slab(3, 4, 2), slab(4, 4, 2), slab(5, 4, 2), stair(6, 4, 2),
    stair(0, 4, 3), slab(1, 4, 3), slab(2, 4, 3), slab(3, 4, 3), slab(4, 4, 3), slab(5, 4, 3), stair(6, 4, 3),
    stair(0, 4, 4), slab(1, 4, 4), slab(2, 4, 4), slab(3, 4, 4), slab(4, 4, 4), slab(5, 4, 4), stair(6, 4, 4),
    stair(0, 4, 5), slab(1, 4, 5), slab(2, 4, 5), slab(3, 4, 5), slab(4, 4, 5), slab(5, 4, 5), stair(6, 4, 5),
    stair(0, 4, 6), slab(1, 4, 6), slab(2, 4, 6), slab(3, 4, 6), slab(4, 4, 6), slab(5, 4, 6), stair(6, 4, 6),

    // --- Interior torches ---
    torch(1, 2, 1),
    torch(5, 2, 1),
    torch(1, 2, 5),
    torch(5, 2, 5),
  ],
};
