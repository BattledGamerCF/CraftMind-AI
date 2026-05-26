import type { Structure } from "../types.js";

function dirt(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "dirt" };
}
function cobble(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "cobblestone" };
}
function log(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "oak_log" };
}
function torch(x: number, y: number, z: number) {
  return { offset: { x, y, z }, blockName: "torch" };
}

export const SimpleShelter: Structure = {
  name: "simple_shelter",
  displayName: "Simple Dirt Shelter",
  width: 5,
  height: 3,
  depth: 5,
  blocks: [
    // Floor
    ...([0,1,2,3,4].flatMap((x) => [0,1,2,3,4].map((z) => dirt(x, 0, z)))),

    // Walls y=1
    cobble(0, 1, 0), cobble(1, 1, 0), cobble(2, 1, 0), cobble(3, 1, 0), cobble(4, 1, 0),
    cobble(0, 1, 4), cobble(1, 1, 4), cobble(2, 1, 4), cobble(3, 1, 4), cobble(4, 1, 4),
    cobble(0, 1, 1), cobble(0, 1, 2), cobble(0, 1, 3),
    cobble(4, 1, 1), cobble(4, 1, 2), cobble(4, 1, 3),

    // Walls y=2
    cobble(0, 2, 0), cobble(1, 2, 0), cobble(2, 2, 0), cobble(3, 2, 0), cobble(4, 2, 0),
    cobble(0, 2, 4), cobble(1, 2, 4), cobble(2, 2, 4), cobble(3, 2, 4), cobble(4, 2, 4),
    cobble(0, 2, 1), cobble(0, 2, 2), cobble(0, 2, 3),
    cobble(4, 2, 1), cobble(4, 2, 2), cobble(4, 2, 3),

    // Roof
    ...([0,1,2,3,4].flatMap((x) => [0,1,2,3,4].map((z) => log(x, 3, z)))),

    // Torch
    torch(2, 2, 2),
  ],
};
