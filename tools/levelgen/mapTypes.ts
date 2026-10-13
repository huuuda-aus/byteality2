// Shared map format (same as assets/maps.json): px coordinates, 1-based edge indices.
export interface MapData {
  steps: number; seconds: number; money: number;
  hp_mult: number; speed_mult: number; value_mult: number;
  nodes: [number, number, number][]; // x, y (px), order 0 = source .. 100 = sink
  edges: [number, number][];         // 1-based node indices
  buildings: [number, number, number][]; // x, y, hp
  towers: string[];
}

/** mulberry32: small seeded PRNG so generated levels are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
