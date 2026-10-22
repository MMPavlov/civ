import { getGeo } from './geo';
import { logEvent } from './log';
import { addPop, cellTotal, compactCell } from './pop';
import type { SimState } from './types';

/** Effective capacity of a cell: rural carrying capacity plus urban jobs of its settlement. */
export function effectiveCapacity(state: SimState, idx: number): number {
  const hex = state.map.hexes[idx];
  const sid = state.cells[idx].settlement;
  const jobs = sid >= 0 && state.settlements[sid].alive ? state.settlements[sid].jobs : 0;
  return hex.capacity + jobs;
}

export function growthRate(state: SimState, cloudId: number, raceId: number, idx: number): number {
  const cloud = state.clouds[cloudId];
  const race = state.races[raceId];
  const cls = state.config.clouds.classes[cloud.cls];
  const aff = race.affinity[state.map.hexes[idx].terrain] ?? 1;
  return state.config.demography.baseGrowth * race.growth * cls.growth * aff;
}

/**
 * Births and deaths (turn stage 5).
 *     births  = r·n·max(0, 1 − N/K)·φ²
 *     crowding deaths = r·n·max(0, N/K − 1)
 *     famine deaths   = μ·n·(1 − φ)
 * where φ is the share of the food need actually consumed this turn.
 * Logistic growth therefore stops at the carrying capacity and food
 * shortages turn growth negative. Tiny remnants (< minGroup) merge into the
 * largest neighbouring group of the same cloud, or die out.
 */
export function runDemography(state: SimState): { births: number; deaths: number; famine: number } {
  const cfg = state.config.demography;
  const geo = getGeo(state);
  let births = 0;
  let deaths = 0;
  let famine = 0;
  const famineByCloud = new Map<number, number>();

  for (let idx = 0; idx < state.cells.length; idx++) {
    const cell = state.cells[idx];
    if (!cell.groups.length) continue;
    const N = cellTotal(cell);
    const K = Math.max(1, effectiveCapacity(state, idx));
    const phi = cell.food.ratio;
    const crowd = N / K;
    for (const g of cell.groups) {
      const n = g.rural + g.urban;
      if (n <= 0) continue;
      const r = growthRate(state, g.cloud, g.race, idx);
      const b = r * n * Math.max(0, 1 - crowd) * phi * phi;
      const dc = r * n * Math.max(0, crowd - 1);
      const df = cfg.famineMortality * n * (1 - phi);
      const delta = Math.max(-n, b - dc - df);
      const ruralShare = g.rural / n;
      g.rural = Math.max(0, g.rural + delta * ruralShare);
      g.urban = Math.max(0, g.urban + delta * (1 - ruralShare));
      births += b;
      deaths += dc + df;
      famine += df;
      if (df > 0) famineByCloud.set(g.cloud, (famineByCloud.get(g.cloud) ?? 0) + df);
    }
  }

  // Remnant cleanup.
  for (let idx = 0; idx < state.cells.length; idx++) {
    const cell = state.cells[idx];
    for (const g of cell.groups) {
      const n = g.rural + g.urban;
      if (n <= 0 || n >= cfg.minGroup) continue;
      let best = -1;
      let bestPop = 0;
      for (const nb of geo.neighbors[idx]) {
        for (const h of state.cells[nb].groups) {
          if (h.cloud === g.cloud && h.rural + h.urban > bestPop) {
            bestPop = h.rural + h.urban;
            best = nb;
          }
        }
      }
      if (best >= 0) addPop(state.cells[best], g.cloud, g.race, g.culture, n, 0);
      else deaths += n;
      g.rural = 0;
      g.urban = 0;
    }
    compactCell(cell);
  }

  state.counters.famineDeaths += famine;
  for (const [cloudId, lost] of famineByCloud) {
    const cloud = state.clouds[cloudId];
    if (lost > 25 && state.turn % 10 === 0) {
      logEvent(state, 'famine', [cloudId], 'Нехватка продовольствия', `${cloud.name}: потери от голода ≈ ${Math.round(lost)}`);
    }
  }
  return { births, deaths, famine };
}
