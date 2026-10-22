import type { Cell, Cloud, PopGroup, SimState } from './types';

export function groupTotal(g: PopGroup): number {
  return g.rural + g.urban;
}

export function cellTotal(cell: Cell): number {
  let s = 0;
  for (const g of cell.groups) s += g.rural + g.urban;
  return s;
}

export function cellUrban(cell: Cell): number {
  let s = 0;
  for (const g of cell.groups) s += g.urban;
  return s;
}

export function cellRural(cell: Cell): number {
  let s = 0;
  for (const g of cell.groups) s += g.rural;
  return s;
}

/** Add population to a cell, merging into an existing (cloud, race, culture) group. */
export function addPop(cell: Cell, cloud: number, race: number, culture: number, rural: number, urban = 0): PopGroup {
  let g = cell.groups.find((x) => x.cloud === cloud && x.race === race && x.culture === culture);
  if (!g) {
    g = { cloud, race, culture, rural: 0, urban: 0 };
    cell.groups.push(g);
  }
  g.rural += rural;
  g.urban += urban;
  return g;
}

/** Merge duplicate keys and drop empty groups. Keeps a deterministic order. */
export function compactCell(cell: Cell): void {
  const merged: PopGroup[] = [];
  for (const g of cell.groups) {
    if (g.rural < 0) g.rural = 0;
    if (g.urban < 0) g.urban = 0;
    const m = merged.find((x) => x.cloud === g.cloud && x.race === g.race && x.culture === g.culture);
    if (m) {
      m.rural += g.rural;
      m.urban += g.urban;
    } else merged.push(g);
  }
  cell.groups = merged.filter((g) => g.rural + g.urban > 1e-9);
  cell.groups.sort((a, b) => a.cloud - b.cloud || a.culture - b.culture || a.race - b.race);
}

export interface CloudIndex {
  pop: number[];
  urban: number[];
  cells: number[][];
  /** Population of each cloud on each of its cells, aligned with `cells`. */
  cellPop: number[][];
}

/** Per-cloud totals and occupied cells (computed fresh, never stored). */
export function indexClouds(state: SimState): CloudIndex {
  const n = state.clouds.length;
  const pop = new Array<number>(n).fill(0);
  const urban = new Array<number>(n).fill(0);
  const cells: number[][] = Array.from({ length: n }, () => []);
  const cellPop: number[][] = Array.from({ length: n }, () => []);
  state.cells.forEach((cell, idx) => {
    for (const g of cell.groups) {
      const t = g.rural + g.urban;
      if (t <= 0) continue;
      pop[g.cloud] += t;
      urban[g.cloud] += g.urban;
      const list = cells[g.cloud];
      if (list.length && list[list.length - 1] === idx) cellPop[g.cloud][list.length - 1] += t;
      else {
        list.push(idx);
        cellPop[g.cloud].push(t);
      }
    }
  });
  return { pop, urban, cells, cellPop };
}

export function cloudPopOnCell(cell: Cell, cloud: number): number {
  let s = 0;
  for (const g of cell.groups) if (g.cloud === cloud) s += g.rural + g.urban;
  return s;
}

/** Cloud with the largest population on the cell (ties: lowest id), or -1. */
export function dominantCloud(cell: Cell, filter?: (cloudId: number) => boolean): number {
  const totals = new Map<number, number>();
  for (const g of cell.groups) {
    if (filter && !filter(g.cloud)) continue;
    totals.set(g.cloud, (totals.get(g.cloud) ?? 0) + g.rural + g.urban);
  }
  let best = -1;
  let bestPop = 0;
  for (const [id, p] of totals) {
    if (p > bestPop || (p === bestPop && id < best)) {
      best = id;
      bestPop = p;
    }
  }
  return best;
}

export function totalPopulation(state: SimState): number {
  let s = 0;
  for (const c of state.cells) s += cellTotal(c);
  return s;
}

export function aliveClouds(state: SimState): Cloud[] {
  return state.clouds.filter((c) => c.alive);
}

/** Shannon diversity (in nats) of cultures on a cell. */
export function cultureDiversity(cell: Cell): number {
  const totals = new Map<number, number>();
  let all = 0;
  for (const g of cell.groups) {
    const t = g.rural + g.urban;
    totals.set(g.culture, (totals.get(g.culture) ?? 0) + t);
    all += t;
  }
  if (all <= 0) return 0;
  let h = 0;
  for (const v of totals.values()) {
    const p = v / all;
    if (p > 0) h -= p * Math.log(p);
  }
  return h;
}
