import { defaultConfig, mergeConfig, type SimConfig } from '../src/sim/config';
import { addCloud, createEmptyState, type CloudSpec } from '../src/sim/init';
import { mapFromTerrain } from '../src/sim/mapgen';
import { makeRng } from '../src/sim/rng';
import { recordStats } from '../src/sim/stats';
import type { SimState, TerrainId } from '../src/sim/types';
import { updateVisibility } from '../src/sim/visibility';

export function testConfig(patch: unknown = {}): SimConfig {
  return mergeConfig(defaultConfig(), patch);
}

export interface ScenarioSpec {
  width: number;
  height: number;
  terrainAt: (col: number, row: number) => TerrainId;
  rivers?: Array<Array<[number, number]>>;
  clouds: Array<Omit<CloudSpec, 'cells'> & { cells: Array<[number, number]> }>;
  seed?: string;
  config?: unknown;
}

/** Hand-built world: explicit terrain grid, explicit clouds. */
export function buildScenario(spec: ScenarioSpec): SimState {
  const config = testConfig(spec.config ?? {});
  config.map.width = spec.width;
  config.map.height = spec.height;
  const seed = spec.seed ?? 'scenario';
  const map = mapFromTerrain(config.map, spec.width, spec.height, spec.terrainAt, spec.rivers ?? []);
  const state = createEmptyState(config, seed, map);
  const rng = makeRng(`${seed}::placement`);
  for (const c of spec.clouds) {
    addCloud(state, { ...c, cells: c.cells.map(([col, row]) => row * spec.width + col) }, rng);
  }
  state.counters.initialLarge = state.clouds.filter((c) => c.cls === 'large').length;
  state.counters.initialMedium = state.clouds.filter((c) => c.cls === 'medium').length;
  state.counters.initialSmall = state.clouds.filter((c) => c.cls === 'small').length;
  updateVisibility(state);
  recordStats(state);
  return state;
}

/** Ocean frame around the map, given terrain inside. */
export function framed(inner: (col: number, row: number) => TerrainId, width: number, height: number) {
  return (col: number, row: number): TerrainId =>
    col === 0 || row === 0 || col === width - 1 || row === height - 1 ? 'ocean' : inner(col, row);
}

/** Total population and totals per race and per culture. */
export function census(state: SimState): { total: number; byRace: Map<number, number>; byCulture: Map<number, number>; byCloud: Map<number, number> } {
  const byRace = new Map<number, number>();
  const byCulture = new Map<number, number>();
  const byCloud = new Map<number, number>();
  let total = 0;
  for (const cell of state.cells) {
    for (const g of cell.groups) {
      const n = g.rural + g.urban;
      total += n;
      byRace.set(g.race, (byRace.get(g.race) ?? 0) + n);
      byCulture.set(g.culture, (byCulture.get(g.culture) ?? 0) + n);
      byCloud.set(g.cloud, (byCloud.get(g.cloud) ?? 0) + n);
    }
  }
  return { total, byRace, byCulture, byCloud };
}

export function cellsOf(state: SimState, cloudId: number): number[] {
  const out: number[] = [];
  state.cells.forEach((c, i) => {
    if (c.groups.some((g) => g.cloud === cloudId && g.rural + g.urban > 0)) out.push(i);
  });
  return out;
}

export function block(c0: number, r0: number, w: number, h: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) out.push([c, r]);
  return out;
}

export function closeTo(a: number, b: number, rel = 1e-9): boolean {
  return Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
}
