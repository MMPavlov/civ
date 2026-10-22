import type { SimConfig } from './config';
import { buildNeighbors } from './hex';
import type { GameMap, SimState } from './types';

/**
 * Derived, cacheable geography: adjacency, edge costs and the transport
 * neighbourhood of each cell. Depends only on the static map and a few config
 * values, so it is computed once and never serialized.
 */
export interface Geo {
  neighbors: number[][];
  /** Movement / transport cost of the edge i -> neighbors[i][k]. */
  edgeCost: number[][];
  /** Cells reachable within reachRadius(config), sorted by cost (rivers make transport cheaper). */
  reach: Array<Array<{ idx: number; cost: number }>>;
  /** Same, but over land only: people walk to a market, rivers do not shorten that trip. */
  serviceReach: Array<Array<{ idx: number; cost: number }>>;
  /** Cells within sight radius (grid distance). */
  sight: number[][];
  land: number[];
  habitable: boolean[];
}

const cache = new WeakMap<GameMap, Map<string, Geo>>();

export function getGeo(state: SimState): Geo {
  return geoFor(state.map, state.config);
}

export function geoFor(map: GameMap, config: SimConfig): Geo {
  const key = `${reachRadius(config)}|${config.food.riverCostFactor}|${config.clouds.sightRadius}|${config.settlements.tiers.map((t) => t.radius).join(',')}`;
  let perMap = cache.get(map);
  if (!perMap) {
    perMap = new Map();
    cache.set(map, perMap);
  }
  let geo = perMap.get(key);
  if (!geo) {
    geo = buildGeo(map, config);
    perMap.set(key, geo);
  }
  return geo;
}

function buildGeo(map: GameMap, config: SimConfig): Geo {
  const { width, height, hexes } = map;
  const neighbors = buildNeighbors(width, height);
  const habitable = hexes.map((h) => h.capacity > 0);
  const land = hexes.filter((h) => h.terrain !== 'ocean' && h.terrain !== 'lake').map((h) => h.idx);
  const edgeCost = neighbors.map((list, i) =>
    list.map((j) => {
      const a = hexes[i];
      const b = hexes[j];
      if (!Number.isFinite(b.moveCost) || !Number.isFinite(a.moveCost)) return Infinity;
      let c = (a.moveCost + b.moveCost) / 2;
      if (a.riverTo === j || b.riverTo === i) c *= config.food.riverCostFactor;
      return c;
    }),
  );
  const reach = hexes.map((h) =>
    habitable[h.idx] ? dijkstra(h.idx, neighbors, edgeCost, reachRadius(config)) : [],
  );
  const landCost = neighbors.map((list, i) =>
    list.map((j) => (Number.isFinite(hexes[i].moveCost) && Number.isFinite(hexes[j].moveCost) ? (hexes[i].moveCost + hexes[j].moveCost) / 2 : Infinity)),
  );
  const serviceRadius = Math.max(...config.settlements.tiers.map((t) => t.radius));
  const serviceReach = hexes.map((h) => (habitable[h.idx] ? dijkstra(h.idx, neighbors, landCost, serviceRadius) : []));
  const sight = hexes.map((h) => gridWithin(h.idx, neighbors, config.clouds.sightRadius));
  return { neighbors, edgeCost, reach, serviceReach, sight, land, habitable };
}

/** Reach lists must cover both food transport and the widest service tier. */
export function reachRadius(config: SimConfig): number {
  return Math.max(config.food.transportRadius, ...config.settlements.tiers.map((t) => t.radius));
}

export function dijkstra(
  src: number,
  neighbors: number[][],
  edgeCost: number[][],
  maxCost: number,
): Array<{ idx: number; cost: number }> {
  const dist = new Map<number, number>([[src, 0]]);
  const done = new Set<number>();
  // Small graphs: a simple binary heap is plenty.
  const heap: Array<[number, number]> = [[0, src]];
  const out: Array<{ idx: number; cost: number }> = [];
  while (heap.length) {
    const [d, i] = heapPop(heap);
    if (done.has(i)) continue;
    done.add(i);
    out.push({ idx: i, cost: d });
    const nb = neighbors[i];
    for (let k = 0; k < nb.length; k++) {
      const c = edgeCost[i][k];
      if (!Number.isFinite(c)) continue;
      const nd = d + c;
      if (nd > maxCost) continue;
      const j = nb[k];
      if (nd < (dist.get(j) ?? Infinity)) {
        dist.set(j, nd);
        heapPush(heap, [nd, j]);
      }
    }
  }
  return out;
}

function gridWithin(src: number, neighbors: number[][], radius: number): number[] {
  const seen = new Set<number>([src]);
  let frontier = [src];
  for (let k = 0; k < radius; k++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const n of neighbors[i]) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}

function heapPush(h: Array<[number, number]>, item: [number, number]): void {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] < h[i][0] || (h[p][0] === h[i][0] && h[p][1] <= h[i][1])) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h: Array<[number, number]>): [number, number] {
  const top = h[0];
  const last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && less(h[l], h[m])) m = l;
      if (r < h.length && less(h[r], h[m])) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

function less(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}
