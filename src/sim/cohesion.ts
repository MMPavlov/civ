import { distanceById, makeHybrid } from './culture';
import { getGeo } from './geo';
import { logEvent } from './log';
import { clamp } from './noise';
import { compactCell, type CloudIndex } from './pop';
import { relationsOf } from './relations';
import type { Cloud, InternalGroup, SimState } from './types';

export interface GroupStat {
  group: InternalGroup;
  pop: number;
  share: number;
  distance: number;
  weight: number;
  /** Share of the group's people living on cells where the core culture is ≥ 20 %. */
  coResidence: number;
  /** Share of the group's people in the cloud's main connected region. */
  mainRegion: number;
}

export interface Region {
  cells: number[];
  pop: number;
}

/** Connected components of a cloud's cells (adjacent and passable), largest first. */
export function cloudRegions(state: SimState, cloudId: number, index: CloudIndex): Region[] {
  const geo = getGeo(state);
  const cells = index.cells[cloudId];
  const pops = index.cellPop[cloudId];
  const popOf = new Map<number, number>();
  cells.forEach((c, j) => popOf.set(c, pops[j]));
  const seen = new Set<number>();
  const regions: Region[] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const region: Region = { cells: [], pop: 0 };
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      region.cells.push(i);
      region.pop += popOf.get(i) ?? 0;
      geo.neighbors[i].forEach((n, k) => {
        if (!seen.has(n) && popOf.has(n) && Number.isFinite(geo.edgeCost[i][k])) {
          seen.add(n);
          stack.push(n);
        }
      });
    }
    region.cells.sort((a, b) => a - b);
    regions.push(region);
  }
  regions.sort((a, b) => b.pop - a.pop || a.cells[0] - b.cells[0]);
  return regions;
}

/**
 * Cultural load L = Σ_i w_i with w_i = loadScale · D_i · (b + (1−b)·O_i/100) · √P_i
 * (D: distance from the cloud's core culture, O: isolation, P: population share).
 * The core group has D = 0 and adds nothing.
 */
export function groupStats(state: SimState, cloud: Cloud, index: CloudIndex, regions?: Region[]): GroupStat[] {
  const cfg = state.config.culture;
  const total = index.pop[cloud.id];
  const byCulture = new Map<number, number>();
  const coRes = new Map<number, number>();
  const inMain = new Map<number, number>();
  const main = new Set((regions ?? cloudRegions(state, cloud.id, index))[0]?.cells ?? []);
  for (const idx of index.cells[cloud.id]) {
    const cell = state.cells[idx];
    let cloudHere = 0;
    let coreHere = 0;
    for (const g of cell.groups) {
      if (g.cloud !== cloud.id) continue;
      cloudHere += g.rural + g.urban;
      if (g.culture === cloud.culture) coreHere += g.rural + g.urban;
    }
    for (const g of cell.groups) {
      if (g.cloud !== cloud.id) continue;
      const key = groupKey(g.culture, g.race);
      const n = g.rural + g.urban;
      byCulture.set(key, (byCulture.get(key) ?? 0) + n);
      if (cloudHere > 0 && coreHere / cloudHere >= 0.2) coRes.set(key, (coRes.get(key) ?? 0) + n);
      if (main.has(idx)) inMain.set(key, (inMain.get(key) ?? 0) + n);
    }
  }
  return cloud.groups.map((group) => {
    const key = groupKey(group.culture, group.race);
    const pop = byCulture.get(key) ?? 0;
    const share = total > 0 ? pop / total : 0;
    const distance = distanceById(state, group.culture, cloud.culture);
    const weight = cfg.loadScale * distance * (cfg.loadIsolationBase + (1 - cfg.loadIsolationBase) * group.isolation / 100) * Math.sqrt(share);
    return {
      group, pop, share, distance, weight,
      coResidence: pop > 0 ? (coRes.get(key) ?? 0) / pop : 0,
      mainRegion: pop > 0 ? (inMain.get(key) ?? 0) / pop : 0,
    };
  });
}

const groupKey = (culture: number, race: number) => culture * 1000 + race;

/** Make sure every (culture, race) the cloud's people carry has an internal group entry. */
export function syncGroups(state: SimState, cloud: Cloud, index: CloudIndex): void {
  const present = new Map<number, { culture: number; race: number }>();
  for (const idx of index.cells[cloud.id]) {
    for (const g of state.cells[idx].groups) {
      if (g.cloud === cloud.id) present.set(groupKey(g.culture, g.race), { culture: g.culture, race: g.race });
    }
  }
  for (const [key, v] of present) {
    if (!cloud.groups.some((g) => groupKey(g.culture, g.race) === key)) {
      const parent = cloud.groups.find((g) => g.race === v.race) ?? cloud.groups[0];
      cloud.groups.push({
        culture: v.culture, race: v.race, isolation: parent?.isolation ?? cloud.isolation, joinedTurn: state.turn,
        origin: state.cultures[v.culture].name, originCloud: cloud.id, hybridProgress: 0, cohesion: parent?.cohesion ?? cloud.cohesion, schismRisk: 0,
      });
    }
  }
  cloud.groups = cloud.groups.filter((g) => present.has(groupKey(g.culture, g.race)) || g.culture === cloud.culture);
}

/**
 * Cohesion (turn stage 9). Target cohesion is a weighted mean of positive
 * factors minus penalties, scaled by the race's cohesion modifier:
 *   closeness   = 1 − Σ P_i·D_i
 *   interests   = common external threat / trade partners
 *   economy     = share of people whose food need is met
 *   history     = mean time spent together (capped at historyTurns)
 *   institutions, geography (share in the main connected region)
 *   overload    = max(0, L/C − 1),  conflict = war weariness
 * Actual cohesion moves towards the target with inertia. Per-group cohesion
 * uses the same idea at group level.
 */
export function updateCohesion(state: SimState, index: CloudIndex): void {
  const cfg = state.config.culture;
  const wc = cfg.cohesionWeights;
  for (const cloud of state.clouds) {
    if (!cloud.alive) continue;
    syncGroups(state, cloud, index);
    const regions = cloudRegions(state, cloud.id, index);
    const stats = groupStats(state, cloud, index, regions);
    const race = state.races[cloud.race];
    cloud.load = stats.reduce((s, g) => s + g.weight, 0);
    cloud.capacity = race.cultureCapacity * (1 + cfg.institutionsCapacityBonus * cloud.institutions);
    const total = index.pop[cloud.id];
    const overload = clamp(cloud.load / Math.max(0.1, cloud.capacity) - 1, 0, 2);
    const closeness = 1 - stats.reduce((s, g) => s + g.share * g.distance, 0);
    const rels = relationsOf(state, cloud.id);
    const wars = rels.filter((r) => r.status === 'war');
    const weariness = wars.reduce((s, r) => s + (r.war?.weariness ?? 0), 0);
    const interests = clamp((wars.length ? 0.6 : 0) + 0.15 * rels.filter((r) => r.status === 'trade' || r.status === 'alliance').length, 0, 1);
    let fed = 0;
    index.cells[cloud.id].forEach((idx, j) => (fed += index.cellPop[cloud.id][j] * state.cells[idx].food.ratio));
    const economy = total > 0 ? fed / total : 1;
    const age = (g: InternalGroup) => clamp((state.turn - g.joinedTurn) / cfg.historyTurns, 0, 1);
    const history = stats.reduce((s, g) => s + g.share * (g.group.culture === cloud.culture ? 1 : age(g.group)), 0);
    // Geography: share of people in the main connected region, reduced when the
    // area outgrows what the institutions can coordinate.
    const sprawl = clamp(index.cells[cloud.id].length / (40 + 120 * cloud.institutions) - 1, 0, 1);
    const geography = (total > 0 ? (regions[0]?.pop ?? 0) / total : 1) * (1 - 0.5 * sprawl);
    const conflict = clamp(weariness * 0.6, 0, 1);
    const pos = wc.closeness * closeness + wc.interests * interests + wc.economy * economy + wc.history * history +
      wc.institutions * cloud.institutions + wc.geography * geography;
    const posW = wc.closeness + wc.interests + wc.economy + wc.history + wc.institutions + wc.geography;
    const target = clamp((0.1 + 0.8 * (pos / posW)) * Math.pow(race.cohesion, 0.6) - wc.overload * overload - wc.conflict * conflict, 0, 1);
    cloud.cohesion = clamp(cloud.cohesion + cfg.cohesionInertia * (target - cloud.cohesion), 0, 1);

    for (const gs of stats) {
      const g = gs.group;
      const gTarget = g.culture === cloud.culture
        ? cloud.cohesion
        : clamp(0.85 - gs.distance * (0.4 + 0.6 * g.isolation / 100) * (1 + overload) + 0.25 * age(g) - 0.3 * (1 - gs.mainRegion) - 0.2 * conflict, 0, 1) * race.cohesion;
      g.cohesion = clamp(g.cohesion + cfg.cohesionInertia * (clamp(gTarget, 0, 1) - g.cohesion), 0, 1);
    }
  }
}

/**
 * Hybridisation (turn stage 8). Integrated groups living among the core
 * culture slowly converge: progress += rate·(1 − O/100)·(0.3 + 0.7·coResidence)·(0.5 + cohesion).
 * On completion a large group (share ≥ hybridCoreShare) fuses with the core
 * into a new hybrid culture that becomes the cloud's culture; a smaller one
 * adopts an intermediate culture that keeps part of its traditions. Only the
 * culture label of existing people changes; numbers are untouched.
 */
export function runHybridization(state: SimState, index: CloudIndex): void {
  const cfg = state.config.culture;
  for (const cloud of state.clouds) {
    if (!cloud.alive || cloud.groups.length < 2) continue;
    const stats = groupStats(state, cloud, index);
    const core = stats.find((s) => s.group.culture === cloud.culture);
    for (const gs of stats) {
      const g = gs.group;
      if (g.culture === cloud.culture || gs.pop <= 0) continue;
      g.hybridProgress += cfg.hybridRate * (1 - g.isolation / 100) * (0.3 + 0.7 * gs.coResidence) * (0.5 + cloud.cohesion);
      if (g.hybridProgress < 1) continue;
      g.hybridProgress = 0;
      const coreCulture = state.cultures[cloud.culture];
      const groupCulture = state.cultures[g.culture];
      const coreShare = core?.share ?? 0;
      if (gs.share >= cfg.hybridCoreShare) {
        const h = makeHybrid(state, coreCulture, groupCulture, gs.share / (gs.share + coreShare), state.rng);
        relabel(state, cloud.id, [cloud.culture, g.culture], h.id);
        const oldCore = cloud.culture;
        cloud.culture = h.id;
        for (const x of cloud.groups) if (x.culture === oldCore || x === g) x.culture = h.id;
        mergeDuplicateGroups(cloud);
        state.counters.hybrids++;
        logEvent(state, 'hybrid', [cloud.id], `Длительное совместное проживание; доля группы ${(gs.share * 100).toFixed(0)}%`,
          `В ${cloud.name} сложилась гибридная культура «${h.name}» (${coreCulture.name} + ${groupCulture.name})`);
        break; // core changed; recompute next turn
      } else {
        const h = makeHybrid(state, coreCulture, groupCulture, cfg.hybridDistanceKeep, state.rng);
        const close = distanceById(state, h.id, cloud.culture) < 0.06;
        const to = close ? cloud.culture : h.id;
        relabel(state, cloud.id, [g.culture], to, g.race);
        g.culture = to;
        g.isolation *= 0.8;
        mergeDuplicateGroups(cloud);
        logEvent(state, 'assimilation', [cloud.id], `Совместное проживание (${(gs.coResidence * 100).toFixed(0)}% среди основной культуры)`,
          close
            ? `Группа «${groupCulture.name}» в ${cloud.name} слилась с основной культурой`
            : `Группа «${groupCulture.name}» в ${cloud.name} сблизилась с основной культурой («${h.name}»), сохранив часть традиций`);
      }
    }
  }
}

/** Change the culture label of a cloud's people. Population numbers are not touched. */
function relabel(state: SimState, cloudId: number, from: number[], to: number, race?: number): void {
  const set = new Set(from);
  for (const cell of state.cells) {
    let touched = false;
    for (const g of cell.groups) {
      if (g.cloud === cloudId && set.has(g.culture) && (race === undefined || g.race === race)) {
        g.culture = to;
        touched = true;
      }
    }
    if (touched) compactCell(cell);
  }
}

function mergeDuplicateGroups(cloud: Cloud): void {
  const out: InternalGroup[] = [];
  for (const g of cloud.groups) {
    const m = out.find((x) => x.culture === g.culture && x.race === g.race);
    if (m) {
      m.isolation = Math.min(m.isolation, g.isolation);
      m.joinedTurn = Math.min(m.joinedTurn, g.joinedTurn);
      m.cohesion = Math.max(m.cohesion, g.cohesion);
    } else out.push(g);
  }
  cloud.groups = out;
}
