import type { SimConfig } from './config';
import { buildNeighbors, offsetToAxial } from './hex';
import { clamp, fbm, makeNoise2D, ridged, smoothstep } from './noise';
import { fork, rand, shuffle } from './rng';
import type { GameMap, Hex, TerrainId } from './types';

type MapConfig = SimConfig['map'];

/**
 * Procedural map: one large continent shaped by a radial mask plus fractal
 * noise, mountain ranges from ridged noise, climate from latitude/elevation,
 * moisture from noise and distance to water, rivers flowing downhill.
 */
export function generateMap(cfg: MapConfig, seed: string): GameMap {
  const W = cfg.width;
  const H = cfg.height;
  const N = W * H;
  const rng = fork(seed, 'map');
  const elevNoise = makeNoise2D(rng);
  const ridgeNoise = makeNoise2D(rng);
  const moistNoise = makeNoise2D(rng);
  const tempNoise = makeNoise2D(rng);
  const fertNoise = makeNoise2D(rng);
  const neighbors = buildNeighbors(W, H);

  const elev = new Array<number>(N);
  const xs = new Array<number>(N);
  const ys = new Array<number>(N);
  const aspect = (H * 0.866) / W;
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      const x = (col + 0.5 * (row & 1)) / W;
      const y = row / (H - 1);
      xs[i] = x;
      ys[i] = y;
      const dx = (x - 0.5) / 0.5;
      const dy = (y - 0.5) / 0.5;
      const d = Math.sqrt(dx * dx * 0.9 + dy * dy * 1.1);
      const mask = 1 - smoothstep(0.45, 1.05, d);
      const n = fbm(elevNoise, x * 3.2, y * 3.2 * aspect, 5);
      let e = 0.6 * mask + 0.45 * n;
      // Keep the map edge as ocean.
      if (col === 0 || row === 0 || col === W - 1 || row === H - 1) e -= 1;
      else if (col === 1 || row === 1 || col === W - 2 || row === H - 2) e -= 0.15;
      elev[i] = e;
    }
  }

  // Sea level chosen as a quantile so the land share matches the setting.
  const sorted = [...elev].sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(clamp(1 - cfg.landFraction, 0.05, 0.95) * (N - 1))];
  const land = elev.map((e) => e > seaLevel);

  // Mountains and hills from ridged noise weighted by elevation above sea.
  const mScore = new Array<number>(N).fill(-1);
  const landIdx: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!land[i]) continue;
    landIdx.push(i);
    const rdg = ridged(ridgeNoise, xs[i] * 4.2, ys[i] * 4.2 * aspect);
    mScore[i] = rdg * (0.5 + (elev[i] - seaLevel)) + 0.05 * rand(rng);
  }
  const m = clamp(cfg.mountainousness, 0, 1);
  const byScore = [...landIdx].sort((a, b) => mScore[b] - mScore[a]);
  const nMount = Math.floor(byScore.length * (0.03 + 0.1 * m));
  const nHills = Math.floor(byScore.length * (0.06 + 0.12 * m));
  const terrain = new Array<TerrainId>(N).fill('ocean');
  const isMount = new Array<boolean>(N).fill(false);
  const isHill = new Array<boolean>(N).fill(false);
  byScore.forEach((idx, rank) => {
    if (rank < nMount) isMount[idx] = true;
    else if (rank < nMount + nHills) isHill[idx] = true;
  });

  // Water: ocean if connected to the edge, otherwise lake.
  const ocean = floodFromEdge(W, H, neighbors, (i) => !land[i]);

  // Distance to water (BFS) for moisture.
  const waterDist = bfsDistance(N, neighbors, (i) => !land[i]);

  const temp = new Array<number>(N);
  const moist = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const height = land[i] ? elev[i] - seaLevel : 0;
    temp[i] =
      0.15 + 0.85 * ys[i] + 0.25 * cfg.climate + 0.12 * fbm(tempNoise, xs[i] * 2.5, ys[i] * 2.5, 3) -
      (isMount[i] ? 0.25 : isHill[i] ? 0.08 : 0) - 0.15 * Math.max(0, height - 0.3);
    moist[i] =
      0.5 + 0.38 * fbm(moistNoise, xs[i] * 3, ys[i] * 3 * aspect, 4) + 0.2 * cfg.humidity +
      0.22 * Math.exp(-waterDist[i] / 2.5) - 0.1;
  }

  // Moisture rank among land cells makes biome shares robust to noise amplitude.
  const moistRank = new Array<number>(N).fill(0);
  const byMoist = [...landIdx].sort((a, b) => moist[a] - moist[b]);
  byMoist.forEach((idx, k) => (moistRank[idx] = k / Math.max(1, byMoist.length - 1)));
  for (let i = 0; i < N; i++) {
    if (!land[i]) {
      terrain[i] = ocean[i] ? 'ocean' : 'lake';
      continue;
    }
    if (isMount[i]) {
      terrain[i] = cfg.snow && temp[i] < 0.1 ? 'snow' : 'mountains';
      continue;
    }
    const t = temp[i];
    const mo = clamp(moistRank[i] + 0.2 * cfg.humidity, 0, 1);
    if (cfg.snow && t < 0.06) terrain[i] = 'snow';
    else if (cfg.tundra && t < 0.2) terrain[i] = 'tundra';
    else if (isHill[i]) terrain[i] = 'hills';
    else if (mo < 0.13 && t > 0.4) terrain[i] = 'desert';
    else if (mo > 0.72) terrain[i] = 'forest';
    else if (mo > 0.4 && t > 0.3 && t < 0.98 && fbm(fertNoise, xs[i] * 3, ys[i] * 3) > -0.05) terrain[i] = 'fertile_plain';
    else terrain[i] = 'plain';
  }

  // Extra small lakes in low interior land.
  const lakeCandidates = landIdx.filter(
    (i) => !isMount[i] && terrain[i] !== 'snow' && neighbors[i].every((n) => land[n]) && elev[i] - seaLevel < 0.25,
  );
  shuffle(rng, lakeCandidates);
  let lakesMade = 0;
  for (const i of lakeCandidates) {
    if (lakesMade >= cfg.lakes) break;
    if (neighbors[i].some((n) => terrain[n] === 'lake')) continue;
    terrain[i] = 'lake';
    lakesMade++;
  }

  const hexes: Hex[] = [];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      const { q, r } = offsetToAxial(col, row);
      hexes.push({
        idx: i, col, row, q, r,
        terrain: terrain[i],
        elevation: land[i] ? elev[i] - seaLevel + (isMount[i] ? 0.6 : isHill[i] ? 0.2 : 0) : elev[i] - seaLevel,
        temperature: temp[i],
        moisture: moist[i],
        fertility: 0, freshWater: 0, moveCost: 0, capacity: 0, agriPotential: 0, defense: 0, appeal: 0,
        river: 0, riverTo: -1, coastal: false,
      });
    }
  }
  const map: GameMap = { width: W, height: H, hexes };
  generateRivers(map, neighbors, cfg.rivers, rng);
  const fertVar = hexes.map((h) => fbm(fertNoise, xs[h.idx] * 5, ys[h.idx] * 5, 2));
  finalizeHexes(map, cfg, fertVar);
  return map;
}

function floodFromEdge(W: number, H: number, neighbors: number[][], pass: (i: number) => boolean): boolean[] {
  const N = W * H;
  const seen = new Array<boolean>(N).fill(false);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    const col = i % W;
    const row = Math.floor(i / W);
    if ((col === 0 || row === 0 || col === W - 1 || row === H - 1) && pass(i)) {
      seen[i] = true;
      queue.push(i);
    }
  }
  while (queue.length) {
    const i = queue.shift()!;
    for (const n of neighbors[i]) {
      if (!seen[n] && pass(n)) {
        seen[n] = true;
        queue.push(n);
      }
    }
  }
  return seen;
}

function bfsDistance(N: number, neighbors: number[][], source: (i: number) => boolean): number[] {
  const dist = new Array<number>(N).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    if (source(i)) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    for (const n of neighbors[i]) {
      if (dist[n] === Infinity) {
        dist[n] = dist[i] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

const isWater = (t: TerrainId) => t === 'ocean' || t === 'lake';
const isBlocked = (t: TerrainId) => t === 'mountains' || t === 'snow';

/** Rivers start on high ground next to mountains/hills and flow downhill to water. */
function generateRivers(map: GameMap, neighbors: number[][], count: number, rng: ReturnType<typeof fork>): void {
  const hexes = map.hexes;
  const sources = hexes
    .filter((h) => !isWater(h.terrain) && !isBlocked(h.terrain) && h.terrain !== 'desert' && h.moisture > 0.38)
    .filter((h) => neighbors[h.idx].some((n) => isBlocked(hexes[n].terrain) || hexes[n].terrain === 'hills'))
    .map((h) => ({ h, score: h.elevation + 0.4 * rand(rng) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.h);

  const chosen: Hex[] = [];
  for (const s of sources) {
    if (chosen.length >= count * 3) break;
    if (chosen.every((c) => hexDist(c, s) >= 4)) chosen.push(s);
  }

  let made = 0;
  for (const src of chosen) {
    if (made >= count) break;
    if (src.river > 0) continue;
    const path: number[] = [src.idx];
    const inPath = new Set<number>([src.idx]);
    let cur = src.idx;
    let end = -1; // index of water/river reached
    for (let step = 0; step < 60; step++) {
      const opts = neighbors[cur].filter((n) => !inPath.has(n) && !isBlocked(hexes[n].terrain));
      if (opts.length === 0) break;
      const water = opts.find((n) => isWater(hexes[n].terrain));
      if (water !== undefined) {
        end = water;
        break;
      }
      const joined = opts.find((n) => hexes[n].river > 0);
      if (joined !== undefined && step > 1) {
        end = joined;
        break;
      }
      opts.sort((a, b) => hexes[a].elevation - hexes[b].elevation);
      const next = opts[0];
      path.push(next);
      inPath.add(next);
      cur = next;
    }
    if (end < 0 || path.length < 3) continue;
    for (let k = 0; k < path.length; k++) {
      const h = hexes[path[k]];
      h.river += k + 1;
      h.riverTo = k + 1 < path.length ? path[k + 1] : end;
    }
    // Propagate flow down an existing river we joined.
    let down = end;
    let guard = 0;
    while (down >= 0 && hexes[down].river > 0 && guard++ < 200) {
      hexes[down].river += path.length;
      down = hexes[down].riverTo;
    }
    made++;
  }
}

function hexDist(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Derive per-cell economic attributes from terrain, rivers and water.
 * Shared by the procedural generator and by hand-built test scenarios.
 */
export function finalizeHexes(map: GameMap, cfg: MapConfig, fertVar?: number[]): void {
  const neighbors = buildNeighbors(map.width, map.height);
  const hexes = map.hexes;
  for (const h of hexes) {
    // River meadows: farmland along rivers.
    if (h.river > 0 && (h.terrain === 'plain' || h.terrain === 'fertile_plain')) h.terrain = 'river_meadow';
  }
  for (const h of hexes) {
    const t = cfg.terrains[h.terrain];
    const nb = neighbors[h.idx].map((n) => hexes[n]);
    const nearRiver = nb.some((n) => n.river > 0);
    const nearLake = nb.some((n) => n.terrain === 'lake');
    h.coastal = nb.some((n) => isWater(n.terrain));
    const variation = fertVar ? 0.85 + 0.3 * (fertVar[h.idx] * 0.5 + 0.5) : 1;
    h.fertility = t.fertility * cfg.fertility * variation * (h.river > 0 ? 1.12 : 1);
    h.freshWater = isWater(h.terrain)
      ? (h.terrain === 'lake' ? 1 : 0)
      : h.river > 0 || nearLake
        ? 1
        : nearRiver
          ? 0.75
          : clamp(0.15 + 0.5 * h.moisture, 0.1, 0.6) * (h.terrain === 'desert' ? 0.6 : 1);
    h.moveCost = t.permeability > 0 ? 1 / t.permeability : Infinity;
    const relFert = t.fertility > 0 ? clamp(h.fertility / t.fertility, 0.75, 1.3) : 0;
    h.capacity = t.habitable ? t.capacity * relFert * (0.85 + 0.15 * h.freshWater) : 0;
    h.agriPotential = h.capacity * t.agri;
    const nearHigh = nb.some((n) => n.terrain === 'mountains' || n.terrain === 'hills');
    h.defense = clamp(t.defense + (nearHigh ? 0.15 : 0) + (h.river > 0 ? 0.05 : 0), 0, 1);
    const passable = nb.filter((n) => Number.isFinite(n.moveCost)).length;
    h.appeal = t.habitable
      ? clamp(
          0.3 * h.freshWater +
            0.2 * Math.min(1, h.river / 4) +
            0.12 * (h.coastal ? 1 : 0) +
            0.12 * h.defense +
            0.25 * Math.min(1, h.capacity / 130) +
            0.08 * (passable / 6),
          0,
          1,
        )
      : 0;
  }
}

/** Fresh map from an explicit terrain grid (used by test scenarios). */
export function mapFromTerrain(
  cfg: MapConfig,
  width: number,
  height: number,
  terrainAt: (col: number, row: number) => TerrainId,
  rivers: Array<Array<[number, number]>> = [],
): GameMap {
  const hexes: Hex[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const { q, r } = offsetToAxial(col, row);
      const terrain = terrainAt(col, row);
      hexes.push({
        idx: row * width + col, col, row, q, r, terrain,
        elevation: terrain === 'mountains' ? 1 : terrain === 'hills' ? 0.5 : 0.2,
        temperature: 0.6, moisture: terrain === 'desert' ? 0.2 : 0.55,
        fertility: 0, freshWater: 0, moveCost: 0, capacity: 0, agriPotential: 0, defense: 0, appeal: 0,
        river: 0, riverTo: -1, coastal: false,
      });
    }
  }
  const map: GameMap = { width, height, hexes };
  for (const path of rivers) {
    for (let k = 0; k < path.length; k++) {
      const [c, r] = path[k];
      const h = hexes[r * width + c];
      h.river += k + 1;
      h.riverTo = k + 1 < path.length ? path[k + 1][1] * width + path[k + 1][0] : -1;
    }
  }
  finalizeHexes(map, cfg);
  return map;
}
