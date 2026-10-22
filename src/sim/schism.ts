import { cloudRegions, groupStats, type GroupStat } from './cohesion';
import { makeName } from './culture';
import { dijkstra, getGeo } from './geo';
import { cellLabel, logDecision, logEvent } from './log';
import { clamp } from './noise';
import { compactCell, type CloudIndex } from './pop';
import { ensureRelation, relationsOf } from './relations';
import { pick, rand } from './rng';
import type { Cloud, CloudClass, Reason, SimState } from './types';

/**
 * Schisms (turn stage 10). A split needs several factors at once:
 *   risk = (1 − local cohesion) · (0.3 + identity) · concentration · (0.3 + conflict) · viability · 4
 * identity = O/100 · D (a sustained distinct identity), concentration = share
 * of the group living where it is the majority of the cloud, conflict =
 * overload, war burden and food disadvantage, viability = enough people.
 * Risk accumulates over turns (and decays when it falls), so one bad turn
 * never splits a cloud. Detached regions of the core culture can secede the
 * same way, and so can remote provinces beyond the reach of the institutions.
 */
export function checkSchisms(state: SimState, index: CloudIndex): void {
  const cfg = state.config.culture;
  for (const cloud of [...state.clouds]) {
    if (!cloud.alive || cloud.cls === 'small') continue;
    const stats = groupStats(state, cloud, index, cloudRegions(state, cloud.id, index));
    const overload = clamp(cloud.load / Math.max(0.1, cloud.capacity) - 1, 0, 1);
    const wars = relationsOf(state, cloud.id).filter((r) => r.status === 'war');
    const warBurden = clamp(wars.reduce((s, r) => s + (r.war?.weariness ?? 0), 0) * 0.5, 0, 1);
    const coreFood = foodRatioOf(state, cloud, index, cloud.culture);
    let split = false;
    for (const gs of stats) {
      const g = gs.group;
      if (g.culture === cloud.culture) continue;
      const territory = groupTerritory(state, cloud, gs, index);
      const identity = (g.isolation / 100) * gs.distance;
      const groupFood = foodRatioOf(state, cloud, index, g.culture);
      const conflict = clamp(0.5 * overload + 0.5 * warBurden + Math.max(0, coreFood - groupFood) * 2, 0, 1);
      const viability = territory.pop >= cfg.schismMinPop ? clamp(territory.pop / (3 * cfg.schismMinPop), 0.3, 1) : 0;
      const risk = (1 - g.cohesion) * (0.3 + identity) * territory.concentration * (0.3 + conflict) * viability * 4;
      g.schismRisk = Math.max(0, g.schismRisk + (risk > 0.35 ? cfg.schismAccumulation * risk : -cfg.schismDecay));
      if (!split && g.schismRisk >= cfg.schismThreshold) {
        const reasons: Reason[] = [
          { label: 'Низкая локальная сплочённость', value: 1 - g.cohesion },
          { label: 'Обособленная идентичность', value: identity },
          { label: 'Территориальная связанность группы', value: territory.concentration },
          { label: 'Конфликт интересов', value: conflict },
          { label: 'Возможность самостоятельного существования', value: viability },
        ];
        splitOff(state, cloud, territory.cells, g.culture, g.race, g.isolation, reasons, `группа «${state.cultures[g.culture].name}»`);
        split = true;
      }
    }
    if (split) continue;
    // Secession of a detached core region.
    const periphery = peripheryOf(state, cloud, index);
    if (periphery && index.pop[cloud.id] > 0) {
      const share = periphery.pop / index.pop[cloud.id];
      const viable = periphery.pop >= cfg.schismMinPop * 1.5;
      const risk = viable
        ? (1 - periphery.cohesion) * clamp(share * 3, 0, 1) * (0.4 + overload + warBurden + periphery.foreign + 0.3 * clamp(periphery.remoteness - 1, 0, 1)) * 2
        : 0;
      cloud.secessionRisk = Math.max(0, cloud.secessionRisk + (risk > 0.35 ? cfg.schismAccumulation * risk * 0.6 : -cfg.schismDecay));
      if (cloud.secessionRisk >= cfg.schismThreshold) {
        cloud.secessionRisk = 0;
        splitOff(state, cloud, periphery.cells, -1, -1, Math.round(30 + 40 * (1 - periphery.cohesion)), [
          { label: 'Отдалённость от центра', value: periphery.remoteness },
          { label: 'Низкая сплочённость региона', value: 1 - periphery.cohesion },
          { label: 'Доля населения региона', value: share },
          { label: 'Иные культуры в регионе', value: periphery.foreign },
          { label: 'Перегрузка и войны', value: overload + warBurden },
        ], `отдалённый регион ${cellLabel(state, periphery.cells[0])}`);
      }
    } else cloud.secessionRisk = Math.max(0, cloud.secessionRisk - cfg.schismDecay);
  }
}

export interface Periphery {
  cells: number[];
  pop: number;
  /** Mean transport cost from the centre relative to the coordinating radius (≥ 1). */
  remoteness: number;
  /** Regional cohesion: the cloud's cohesion reduced by remoteness. */
  cohesion: number;
  /** Share of the region's people outside the core culture. */
  foreign: number;
}

/**
 * The largest connected region of a cloud lying beyond the radius its
 * institutions can coordinate (transport cost from the capital, or from the
 * most populous cell). Disconnected regions count as infinitely remote.
 * Regional cohesion = cohesion · (1 − 0.4·clamp(remoteness − 1, 0, 1)).
 */
export function peripheryOf(state: SimState, cloud: Cloud, index: CloudIndex): Periphery | null {
  const cells = index.cells[cloud.id];
  if (cells.length < 6) return null;
  const pops = index.cellPop[cloud.id];
  const popOf = new Map<number, number>();
  cells.forEach((c, j) => popOf.set(c, pops[j]));
  let centre = cells[pops.indexOf(Math.max(...pops))];
  if (cloud.polity >= 0) {
    const cap = state.settlements[state.polities[cloud.polity].capital];
    if (cap?.alive && popOf.has(cap.hex)) centre = cap.hex;
  }
  const radius = 6 + 10 * cloud.institutions;
  const geo = getGeo(state);
  const cost = new Map<number, number>();
  for (const { idx, cost: c } of dijkstra(centre, geo.neighbors, geo.edgeCost, radius * 4)) cost.set(idx, c);
  const far = new Set(cells.filter((c) => (cost.get(c) ?? Infinity) > radius));
  if (!far.size) return null;
  // Largest connected group of remote cells.
  const seen = new Set<number>();
  let best: number[] = [];
  let bestPop = 0;
  for (const start of far) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    let p = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      p += popOf.get(i) ?? 0;
      for (const n of geo.neighbors[i]) if (far.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
    if (p > bestPop) {
      bestPop = p;
      best = comp;
    }
  }
  if (!best.length) return null;
  best.sort((a, b) => a - b);
  let costSum = 0;
  let foreign = 0;
  for (const i of best) {
    const c = cost.get(i);
    costSum += ((c === undefined ? radius * 4 : c) / radius) * (popOf.get(i) ?? 0);
    for (const g of state.cells[i].groups) if (g.cloud === cloud.id && g.culture !== cloud.culture) foreign += g.rural + g.urban;
  }
  const remoteness = bestPop > 0 ? costSum / bestPop : 1;
  return {
    cells: best,
    pop: bestPop,
    remoteness,
    cohesion: cloud.cohesion * (1 - 0.4 * clamp(remoteness - 1, 0, 1)),
    foreign: bestPop > 0 ? foreign / bestPop : 0,
  };
}

function foodRatioOf(state: SimState, cloud: Cloud, index: CloudIndex, culture: number): number {
  let fed = 0;
  let n = 0;
  for (const idx of index.cells[cloud.id]) {
    for (const g of state.cells[idx].groups) {
      if (g.cloud !== cloud.id || g.culture !== culture) continue;
      fed += (g.rural + g.urban) * state.cells[idx].food.ratio;
      n += g.rural + g.urban;
    }
  }
  return n > 0 ? fed / n : 1;
}

/** Cells where the group is the majority of the cloud's people, and how much of the group lives there. */
function groupTerritory(state: SimState, cloud: Cloud, gs: GroupStat, index: CloudIndex): { cells: number[]; pop: number; concentration: number } {
  const cells: number[] = [];
  let pop = 0;
  for (const idx of index.cells[cloud.id]) {
    let mine = 0;
    let all = 0;
    for (const g of state.cells[idx].groups) {
      if (g.cloud !== cloud.id) continue;
      all += g.rural + g.urban;
      if (g.culture === gs.group.culture && g.race === gs.group.race) mine += g.rural + g.urban;
    }
    if (all > 0 && mine / all > 0.5) {
      cells.push(idx);
      pop += mine;
    }
  }
  return { cells, pop, concentration: gs.pop > 0 ? pop / gs.pop : 0 };
}

/**
 * Split: the given people on the given cells form a new cloud. Population
 * changes membership only (no duplication); settlements where the new cloud
 * is dominant change owner; a relation between parent and child is created.
 * culture = -1 means "all of the parent's people on these cells".
 */
export function splitOff(
  state: SimState,
  parent: Cloud,
  cells: number[],
  culture: number,
  race: number,
  isolation: number,
  reasons: Reason[],
  what: string,
): Cloud | null {
  const id = state.clouds.length;
  let pop = 0;
  const cellSet = new Set(cells);
  for (const idx of cells) {
    const cell = state.cells[idx];
    for (const g of cell.groups) {
      if (g.cloud !== parent.id) continue;
      if (culture >= 0 && (g.culture !== culture || g.race !== race)) continue;
      g.cloud = id;
      pop += g.rural + g.urban;
    }
    compactCell(cell);
  }
  if (pop <= 0) return null;
  const coreCulture = culture >= 0 ? culture : parent.culture;
  const coreRace = race >= 0 ? race : parent.race;
  const cls: CloudClass = pop >= 1200 && cells.length >= 8 ? 'large' : pop >= 150 && cells.length >= 3 ? 'medium' : 'small';
  const name = `${state.cultures[coreCulture].name.split('-')[0]}-${makeName(state.rng, 1).toLowerCase()}`;
  const child: Cloud = {
    id, name, cls, race: coreRace, culture: coreCulture,
    character: rand(state.rng) < 0.5 ? parent.character : pick(state.rng, ['expansionist', 'integrator', 'isolationist', 'trader', 'conqueror']),
    isolation, maxArea: cls === 'small' ? Math.max(cells.length, 3) : 0,
    hue: (state.cultures[coreCulture].hue + 25) % 360,
    alive: true, absorbedInto: -1, parent: parent.id, bornTurn: state.turn, diedTurn: -1,
    groups: [{
      culture: coreCulture, race: coreRace, isolation, joinedTurn: state.turn, origin: state.cultures[coreCulture].name,
      originCloud: id, hybridProgress: 0, cohesion: 0.7, schismRisk: 0,
    }],
    cohesion: 0.65, load: 0, capacity: state.races[coreRace].cultureCapacity,
    institutions: parent.institutions * 0.4,
    strategy: 'consolidate', strategyTurn: state.turn, strategyReasons: [], lastMajorTurn: state.turn,
    explored: [...parent.explored], polity: -1, stateStreak: 0, stateReasons: [], lastFoundingTurn: state.turn, secessionRisk: 0,
  };
  state.clouds.push(child);
  parent.groups = parent.groups.filter((g) => culture < 0 || !(g.culture === culture && g.race === race) || hasPeople(state, parent.id, g.culture, g.race));
  parent.cohesion = clamp(parent.cohesion + 0.05, 0, 1);
  for (const s of state.settlements) {
    if (!s.alive || s.cloud !== parent.id || !cellSet.has(s.hex)) continue;
    let mine = 0;
    let theirs = 0;
    for (const g of state.cells[s.hex].groups) {
      if (g.cloud === id) mine += g.rural + g.urban;
      if (g.cloud === parent.id) theirs += g.rural + g.urban;
    }
    if (mine > theirs) s.cloud = id;
  }
  const rel = ensureRelation(state, parent.id, id, 10 - 40 * (1 - parent.cohesion));
  rel.status = 'coexist';
  rel.statusSince = state.turn;
  // Treaties of the parent's state lose their basis on the seceding territory.
  if (parent.polity >= 0) {
    for (const t of state.treaties) {
      if (t.alive && (t.a === parent.polity || t.b === parent.polity) && t.cells.some((c) => cellSet.has(c.idx))) {
        t.alive = false;
        t.endedTurn = state.turn;
        t.endReason = `Раскол ${parent.name}`;
        logEvent(state, 'treaty_broken', [parent.id], `Раскол ${parent.name}`, 'Договор о границе требует пересмотра');
      }
    }
  }
  state.counters.schisms++;
  logDecision(state, parent.id, 'schism', `${parent.name}: раскол (${what})`, reasons, { target: id });
  logEvent(state, 'schism', [parent.id, id], reasons.filter((r) => r.value > 0.3).map((r) => r.label).join(', '),
    `От ${parent.name} отделилось облако ${name} (${cls === 'large' ? 'большое' : cls === 'medium' ? 'среднее' : 'малое'}, ≈${Math.round(pop)} чел.)`, cells[0]);
  return child;
}

function hasPeople(state: SimState, cloudId: number, culture: number, race: number): boolean {
  return state.cells.some((c) => c.groups.some((g) => g.cloud === cloudId && g.culture === culture && g.race === race));
}
