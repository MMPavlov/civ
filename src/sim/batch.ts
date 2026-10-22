import type { SimConfig } from './config';
import { createSimulation } from './init';
import { cellUrban, totalPopulation } from './pop';
import { step } from './turn';
import type { SimState } from './types';

/** Final indicators of one run (specification §17.3). */
export interface RunSummary {
  seed: string;
  turns: number;
  stabilized: boolean;
  stabilizedTurn: number;
  reason: string;
  largeClouds: number;
  mediumClouds: number;
  smallClouds: number;
  schisms: number;
  integrations: number;
  integratedSmallShare: number;
  hybrids: number;
  villages: number;
  towns: number;
  cities: number;
  avgCityPop: number;
  urbanShare: number;
  statesFormed: number;
  statesAlive: number;
  treaties: number;
  treatiesAlive: number;
  wars: number;
  totalPop: number;
  ms: number;
}

export interface BatchAggregate {
  runs: number;
  mean: Partial<Record<keyof RunSummary, number>>;
  stabilizedShare: number;
}

export function summarize(state: SimState, ms = 0): RunSummary {
  const alive = state.clouds.filter((c) => c.alive);
  const cities = state.settlements.filter((s) => s.alive && s.level === 3);
  const total = totalPopulation(state);
  let urban = 0;
  for (const c of state.cells) urban += cellUrban(c);
  const smallInitial = state.clouds.filter((c) => c.cls === 'small' && c.parent < 0 && c.bornTurn === 0);
  const smallIntegrated = smallInitial.filter((c) => c.absorbedInto >= 0).length;
  return {
    seed: state.seed,
    turns: state.turn,
    stabilized: state.stability.stabilizedTurn >= 0,
    stabilizedTurn: state.stability.stabilizedTurn,
    reason: state.stability.reason,
    largeClouds: alive.filter((c) => c.cls === 'large').length,
    mediumClouds: alive.filter((c) => c.cls === 'medium').length,
    smallClouds: alive.filter((c) => c.cls === 'small').length,
    schisms: state.counters.schisms,
    integrations: state.counters.integrations,
    integratedSmallShare: smallInitial.length ? smallIntegrated / smallInitial.length : 0,
    hybrids: state.counters.hybrids,
    villages: state.settlements.filter((s) => s.alive && s.level === 1).length,
    towns: state.settlements.filter((s) => s.alive && s.level === 2).length,
    cities: cities.length,
    avgCityPop: cities.length ? cities.reduce((s, c) => s + cellUrban(state.cells[c.hex]), 0) / cities.length : 0,
    urbanShare: total > 0 ? urban / total : 0,
    statesFormed: state.counters.statesFormed,
    statesAlive: state.polities.filter((p) => p.alive).length,
    treaties: state.counters.treaties,
    treatiesAlive: state.treaties.filter((t) => t.alive).length,
    wars: state.counters.wars,
    totalPop: total,
    ms,
  };
}

/** Run one simulation to the end without visualisation. */
export function runToEnd(config: SimConfig, seed: string): RunSummary {
  const t0 = Date.now();
  const s = createSimulation(config, seed);
  while (!s.stability.finished) step(s);
  return summarize(s, Date.now() - t0);
}

export function aggregate(runs: RunSummary[]): BatchAggregate {
  const keys: Array<keyof RunSummary> = [
    'turns', 'largeClouds', 'mediumClouds', 'smallClouds', 'schisms', 'integrations', 'integratedSmallShare', 'hybrids',
    'villages', 'towns', 'cities', 'avgCityPop', 'urbanShare', 'statesFormed', 'statesAlive', 'treaties', 'treatiesAlive', 'wars', 'totalPop',
  ];
  const mean: BatchAggregate['mean'] = {};
  for (const k of keys) mean[k] = runs.length ? runs.reduce((s, r) => s + (r[k] as number), 0) / runs.length : 0;
  return { runs: runs.length, mean, stabilizedShare: runs.length ? runs.filter((r) => r.stabilized).length / runs.length : 0 };
}

export function runBatch(config: SimConfig, seeds: string[], onRun?: (r: RunSummary, i: number) => void): { runs: RunSummary[]; aggregate: BatchAggregate } {
  const runs: RunSummary[] = [];
  seeds.forEach((seed, i) => {
    const r = runToEnd(config, seed);
    runs.push(r);
    onRun?.(r, i);
  });
  return { runs, aggregate: aggregate(runs) };
}
