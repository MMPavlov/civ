/**
 * Seeded pseudo-random generator (mulberry32).
 *
 * The generator state is a plain `{ s: number }` object so it can live inside
 * the simulation state and be serialized with it: saving and loading the state
 * resumes the exact same random sequence.
 */
export interface RngState {
  s: number;
}

export function makeRng(seed: number | string): RngState {
  return { s: hashSeed(seed) };
}

/** Hash an arbitrary seed (number or text) into a 32-bit unsigned integer. */
export function hashSeed(seed: number | string): number {
  const text = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 0x9e3779b9;
}

/** Uniform float in [0, 1). */
export function rand(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(r: RngState, min: number, max: number): number {
  return min + (max - min) * rand(r);
}

/** Integer in [min, max] inclusive. */
export function int(r: RngState, min: number, max: number): number {
  return min + Math.floor(rand(r) * (max - min + 1));
}

export function chance(r: RngState, p: number): boolean {
  return rand(r) < p;
}

export function pick<T>(r: RngState, items: readonly T[]): T {
  return items[Math.floor(rand(r) * items.length)];
}

/** Standard normal sample (Box–Muller). */
export function normal(r: RngState, mean = 0, sd = 1): number {
  const u = Math.max(rand(r), 1e-12);
  const v = rand(r);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Fisher–Yates shuffle in place; returns the same array. */
export function shuffle<T>(r: RngState, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand(r) * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/** Pick an index with probability proportional to non-negative weights. */
export function weightedIndex(r: RngState, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return -1;
  let x = rand(r) * total;
  for (let i = 0; i < weights.length; i++) {
    x -= Math.max(0, weights[i]);
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** Derive an independent generator (e.g. for map generation) from a parent seed. */
export function fork(seed: number | string, salt: string): RngState {
  return makeRng(`${seed}::${salt}`);
}
