import { distanceById } from './culture';
import { effectiveCapacity } from './demography';
import { getGeo } from './geo';
import { cloudName, logDecision, topReasons } from './log';
import { clamp } from './noise';
import { cellTotal, type CloudIndex } from './pop';
import { getRelation, other, relationsOf } from './relations';
import { rand } from './rng';
import type { Cloud, Reason, SimState, StrategyId } from './types';
import { visibleCells, visibleClouds } from './visibility';

/**
 * Behaviour of clouds (turn stage 3). Characters only set weights; every
 * choice is the argmax of U(a) = Σ_j w_j·V_j(a) − R(a) over admissible
 * actions, evaluated on what the cloud knows: its own population, explored
 * geography and the clouds it currently sees or has met.
 */
export interface Knowledge {
  visible: Array<Set<number>>;
  seen: Array<Set<number>>;
}

export type ProposalKind = 'trade' | 'alliance' | 'patronage' | 'integration' | 'war' | 'peace';

export interface Proposal {
  kind: ProposalKind;
  actor: number;
  target: number;
  utility: number;
  reasons: Reason[];
  /** Random tie-breaker drawn when the proposal is made. */
  tiebreak: number;
}

export function buildKnowledge(state: SimState, index: CloudIndex): Knowledge {
  const visible: Array<Set<number>> = [];
  const seen: Array<Set<number>> = [];
  for (const c of state.clouds) {
    if (!c.alive) {
      visible.push(new Set());
      seen.push(new Set());
      continue;
    }
    const v = visibleCells(state, c.id, index);
    visible.push(v);
    seen.push(visibleClouds(state, c.id, v));
  }
  return { visible, seen };
}

/** Military/organisational strength of the part of cloud `id` that `observer` can see. */
export function perceivedStrength(state: SimState, observer: number, id: number, index: CloudIndex, k: Knowledge): number {
  const c = state.clouds[id];
  let pop = 0;
  if (observer === id) pop = index.pop[id];
  else {
    const vis = k.visible[observer];
    index.cells[id].forEach((cell, j) => {
      if (vis.has(cell)) pop += index.cellPop[id][j];
    });
  }
  return pop * (0.5 + c.cohesion) * (1 + c.institutions);
}

export function cloudStrength(state: SimState, id: number, index: CloudIndex): number {
  const c = state.clouds[id];
  return index.pop[id] * (0.5 + c.cohesion) * (1 + c.institutions);
}

interface CloudView {
  pop: number;
  crowding: number;
  freeLand: number;
  famine: number;
  foodBalance: number;
  hostileFrontier: number;
  strangerShare: number;
}

function viewOf(state: SimState, cloud: Cloud, index: CloudIndex): CloudView {
  const geo = getGeo(state);
  const cells = index.cells[cloud.id];
  const pops = index.cellPop[cloud.id];
  const pop = index.pop[cloud.id];
  let crowd = 0;
  let famine = 0;
  let produced = 0;
  let need = 0;
  let stranger = 0;
  const own = new Set(cells);
  const frontier = new Set<number>();
  cells.forEach((idx, j) => {
    const cell = state.cells[idx];
    const N = cellTotal(cell);
    const share = pops[j] / Math.max(1, pop);
    crowd += share * (N / Math.max(1, effectiveCapacity(state, idx)));
    famine += share * (1 - cell.food.ratio);
    if (N > 0) {
      produced += cell.food.produced * (pops[j] / N);
      need += cell.food.need * (pops[j] / N);
      stranger += (N - pops[j]) / N * share;
    }
    for (const n of geo.neighbors[idx]) if (!own.has(n) && cloud.explored[n] && geo.habitable[n]) frontier.add(n);
  });
  let free = 0;
  let hostile = 0;
  for (const t of frontier) {
    const N = cellTotal(state.cells[t]);
    free += Math.max(0, state.map.hexes[t].capacity - N);
    for (const g of state.cells[t].groups) {
      if (getRelation(state, cloud.id, g.cloud)?.status === 'war') hostile += g.rural + g.urban;
    }
  }
  return {
    pop,
    crowding: crowd,
    freeLand: clamp(free / (0.5 * pop + 50), 0, 1),
    famine,
    foodBalance: need > 0 ? (produced - need) / need : 0,
    hostileFrontier: clamp(hostile / (pop + 1), 0, 1),
    strangerShare: stranger,
  };
}

/** Choose the cloud's development strategy (re-evaluated every decisionInterval turns). */
export function chooseStrategies(state: SimState, index: CloudIndex, k: Knowledge): void {
  const interval = Math.max(1, state.config.sim.decisionInterval);
  for (const cloud of state.clouds) {
    if (!cloud.alive) continue;
    if ((state.turn + cloud.id) % interval !== 0 && cloud.strategyTurn > -999) continue;
    const ch = state.config.clouds.characters[cloud.character];
    const w = ch.weights;
    const v = viewOf(state, cloud, index);
    const ratio = cloud.capacity > 0 ? cloud.load / cloud.capacity : 0;
    let integrable = 0;
    let tradeable = 0;
    let weakRivals = 0;
    let threat = 0;
    const myStrength = perceivedStrength(state, cloud.id, cloud.id, index, k);
    for (const rel of relationsOf(state, cloud.id)) {
      const o = other(rel, cloud.id);
      if (!k.seen[cloud.id].has(o)) continue;
      const oc = state.clouds[o];
      const dist = distanceById(state, cloud.culture, oc.culture);
      if (cloud.cls === 'large' && oc.cls !== 'large') {
        integrable += (1 - oc.isolation / 100) * clamp((rel.attitude + 20) / 80, 0, 1) * (1 - dist);
      }
      if (rel.status !== 'war') tradeable += clamp((rel.attitude + 30) / 80, 0, 1);
      const os = perceivedStrength(state, cloud.id, o, index, k);
      if (rel.status === 'war' || rel.attitude < -20) threat += os / (myStrength + 1);
      if (os < myStrength * 0.8 && rel.attitude < 10) weakRivals += 1;
    }
    const V: Record<StrategyId, number> = {
      expand: 0.6 * v.freeLand + 0.4 * clamp((v.crowding - 0.4) * 2, 0, 1),
      consolidate: (1 - cloud.cohesion) + 0.5 * Math.max(0, ratio - 1) + v.famine,
      integrate: cloud.cls === 'large' ? clamp(integrable / 2, 0, 1) * clamp(1.2 - ratio, 0, 1) : 0,
      trade: clamp(tradeable / 3, 0, 1) * (0.5 + 0.5 * clamp(Math.abs(v.foodBalance) * 3, 0, 1)),
      conquer: clamp(weakRivals / 2, 0, 1) * clamp((v.crowding - 0.5) * 2 + 0.3, 0, 1) * (1 - v.freeLand * 0.7),
      isolate: clamp(threat, 0, 1) * 0.6 + 0.4 * v.strangerShare,
    };
    const R: Record<StrategyId, number> = {
      expand: ch.riskAversion * 0.5 * v.hostileFrontier,
      consolidate: 0,
      integrate: ch.riskAversion * 0.4 * Math.max(0, ratio - 0.6),
      trade: 0.03,
      conquer: ch.riskAversion * clamp(threat, 0, 1.5) * 0.6 + 0.1,
      isolate: 0.08,
    };
    const W: Record<StrategyId, number> = {
      expand: w.expand,
      consolidate: w.autonomy * 0.7 + 0.2,
      integrate: w.integrate,
      trade: w.trade,
      conquer: w.conquest,
      isolate: w.autonomy,
    };
    let best: StrategyId = cloud.strategy;
    let bestU = -Infinity;
    const all: Reason[] = [];
    for (const s of Object.keys(V) as StrategyId[]) {
      const u = W[s] * V[s] - R[s] + 0.01 * rand(state.rng);
      all.push({ label: STRATEGY_NAMES[s], value: u });
      if (u > bestU) {
        bestU = u;
        best = s;
      }
    }
    const reasons: Reason[] = [
      { label: 'Свободные земли рядом', value: v.freeLand },
      { label: 'Перенаселённость', value: v.crowding },
      { label: 'Сплочённость', value: cloud.cohesion },
      { label: 'Нагрузка / ёмкость', value: ratio },
      { label: 'Голод', value: v.famine },
      { label: 'Угроза', value: threat },
      ...topReasons(all, 6),
    ];
    if (best !== cloud.strategy || cloud.strategyTurn < 0) {
      logDecision(state, cloud.id, 'strategy', `${cloud.name}: стратегия «${STRATEGY_NAMES[best]}»`, reasons);
    }
    cloud.strategy = best;
    cloud.strategyTurn = state.turn;
    cloud.strategyReasons = reasons;
  }
}

export const STRATEGY_NAMES: Record<StrategyId, string> = {
  expand: 'Расселение',
  consolidate: 'Консолидация',
  integrate: 'Интеграция',
  trade: 'Торговля',
  conquer: 'Завоевание',
  isolate: 'Обособление',
};

/** Food balance (produced − need)/need of a cloud. */
function foodBalance(state: SimState, id: number, index: CloudIndex): number {
  let p = 0;
  let n = 0;
  index.cells[id].forEach((idx, j) => {
    const cell = state.cells[idx];
    const N = cellTotal(cell);
    if (N <= 0) return;
    p += cell.food.produced * (index.cellPop[id][j] / N);
    n += cell.food.need * (index.cellPop[id][j] / N);
  });
  return n > 0 ? (p - n) / n : 0;
}

/**
 * Competition over the same land (0..1): shared cells weighted by scarcity,
 *   stress = clamp((N/K − 0.97)·8 + (1 − φ)·4, 0, 1),
 * so peaceful co-residence on land that still feeds everyone is not a
 * grievance; crowding beyond capacity or hunger on shared land is.
 */
export function contestedLand(state: SimState, a: number, b: number, index: CloudIndex): number {
  let x = 0;
  const bCells = new Map<number, number>();
  index.cells[b].forEach((c, j) => bCells.set(c, index.cellPop[b][j]));
  index.cells[a].forEach((idx, j) => {
    const pb = bCells.get(idx);
    if (pb === undefined) return;
    const cell = state.cells[idx];
    const K = Math.max(1, effectiveCapacity(state, idx));
    const N = cellTotal(cell);
    const stress = clamp((N / K - 0.97) * 8 + (1 - cell.food.ratio) * 4, 0, 1);
    if (stress <= 0) return;
    x += (Math.min(index.cellPop[a][j], pb) / K) * stress;
  });
  return clamp(x / 2, 0, 1);
}

/** A live border treaty between the two peoples' states (wars over treaty land need more). */
export function hasTreaty(state: SimState, a: number, b: number): boolean {
  const pa = state.clouds[a].polity;
  const pb = state.clouds[b].polity;
  if (pa < 0 || pb < 0) return false;
  return state.treaties.some((t) => t.alive && ((t.a === pa && t.b === pb) || (t.a === pb && t.b === pa)) && state.turn - t.turn < state.config.states.treatyMinDuration);
}

/**
 * Diplomatic proposals (one major action per cloud per turn, and a cooldown
 * per pair). Proposals are computed from the same snapshot for every cloud
 * and resolved together in interactions.resolveProposals.
 */
export function proposeActions(state: SimState, index: CloudIndex, k: Knowledge): Proposal[] {
  const icfg = state.config.interactions;
  const proposals: Proposal[] = [];
  for (const cloud of state.clouds) {
    if (!cloud.alive) continue;
    if (state.turn - cloud.lastMajorTurn < 1) continue;
    const ch = state.config.clouds.characters[cloud.character];
    const w = ch.weights;
    const myBal = foodBalance(state, cloud.id, index);
    const myStrength = perceivedStrength(state, cloud.id, cloud.id, index, k);
    const ratio = cloud.capacity > 0 ? cloud.load / cloud.capacity : 0;
    const options: Proposal[] = [];
    for (const rel of relationsOf(state, cloud.id)) {
      const o = other(rel, cloud.id);
      if (!k.seen[cloud.id].has(o) && rel.status !== 'war') continue;
      if (state.turn - rel.lastProposalTurn < icfg.pairCooldown) continue;
      if (rel.integration) continue;
      const oc = state.clouds[o];
      const dist = distanceById(state, cloud.culture, oc.culture);
      const theirStrength = perceivedStrength(state, cloud.id, o, index, k);
      const add = (kind: ProposalKind, utility: number, reasons: Reason[]) =>
        options.push({ kind, actor: cloud.id, target: o, utility, reasons, tiebreak: rand(state.rng) });

      if (rel.status === 'war') {
        const wear = rel.war?.weariness ?? 0;
        const u = (w.trade + w.autonomy) * 0.5 * wear - w.conquest * 0.3 * clamp(myStrength / (theirStrength + 1) - 1, 0, 2);
        add('peace', u, [
          { label: 'Усталость от войны', value: wear },
          { label: 'Соотношение сил', value: myStrength / (theirStrength + 1) },
        ]);
        continue;
      }

      // Trade.
      if ((rel.status === 'contact' || rel.status === 'coexist') && rel.attitude >= icfg.tradeMinAttitude) {
        const theirBal = foodBalance(state, o, index);
        const compl = clamp(Math.abs(myBal - theirBal) * 2, 0, 1) + (state.cultures[cloud.culture].economy !== state.cultures[oc.culture].economy ? 0.3 : 0);
        const V = 0.3 + 0.5 * compl + 0.2 * clamp(rel.attitude / 50, -1, 1);
        add('trade', w.trade * V - 0.05 * ch.riskAversion, [
          { label: 'Хозяйственная взаимодополняемость', value: compl },
          { label: 'Отношение', value: rel.attitude / 100 },
          { label: 'Вес торговли (характер)', value: w.trade },
        ]);
      }
      // Alliance.
      if (rel.status === 'trade' && rel.attitude >= icfg.allianceMinAttitude) {
        const commonEnemy = relationsOf(state, cloud.id).some((r) => r.status === 'war') ? 0.4 : 0;
        const V = 0.3 + commonEnemy + 0.3 * clamp(rel.tradeTurns / 40, 0, 1);
        add('alliance', (w.trade * 0.6 + w.integrate * 0.4) * V - 0.1 * w.autonomy, [
          { label: 'Общий противник', value: commonEnemy },
          { label: 'Длительность торговли', value: rel.tradeTurns },
          { label: 'Отношение', value: rel.attitude / 100 },
        ]);
      }
      // Patronage over a small people.
      if (cloud.cls !== 'small' && oc.cls === 'small' && rel.status !== 'patronage' && rel.status !== 'alliance' && rel.attitude >= icfg.patronageMinAttitude) {
        const V = 0.3 + 0.4 * (1 - oc.isolation / 100) + 0.2 * clamp(index.pop[o] / (index.pop[cloud.id] + 1) * 5, 0, 1);
        add('patronage', (w.integrate * 0.6 + w.conquest * 0.3 + w.trade * 0.2) * V - 0.05, [
          { label: 'Обособленность малого народа', value: oc.isolation / 100 },
          { label: 'Отношение', value: rel.attitude / 100 },
        ]);
      }
      // Integration (large clouds only, of small/medium clouds).
      if (cloud.cls === 'large' && oc.cls !== 'large' && !isIntegrating(state, o)) {
        const gain = clamp(index.pop[o] / (index.pop[cloud.id] + 1) * 4, 0, 1);
        const addedLoad = state.config.culture.loadScale * dist * (state.config.culture.loadIsolationBase + (1 - state.config.culture.loadIsolationBase) * oc.isolation / 100) *
          Math.sqrt(index.pop[o] / (index.pop[cloud.id] + index.pop[o] + 1));
        const capRisk = Math.max(0, (cloud.load + addedLoad) / Math.max(0.1, cloud.capacity) - 0.8);
        const V = 0.35 + 0.4 * gain + (rel.status === 'patronage' && rel.patron === cloud.id ? 0.3 : 0) + 0.2 * clamp(rel.attitude / 60, -1, 1);
        const Rk = ch.riskAversion * (0.6 * capRisk + 0.5 * dist + 0.4 * oc.isolation / 100);
        const u = w.integrate * V - Rk;
        const reasons: Reason[] = [
          { label: 'Прирост численности', value: gain },
          { label: 'Культурная дистанция', value: -dist },
          { label: `Обособленность ${oc.name}`, value: -oc.isolation / 100 },
          { label: 'Риск перегрузки ёмкости', value: -capRisk },
          { label: 'Отношение', value: rel.attitude / 100 },
          { label: 'Вес интеграции (характер)', value: w.integrate },
        ];
        const attitudeOk = rel.attitude >= icfg.integrationMinAttitude && oc.isolation < icfg.integrationIsolationGate;
        if (attitudeOk) add('integration', u, reasons);
        else if (rel.attitude >= icfg.integrationMinAttitude - 10 && state.turn % 20 === cloud.id % 20 && w.integrate >= 0.4) {
          logDecision(state, cloud.id, 'integration', `${cloud.name} отказался интегрировать ${oc.name}`, [
            ...reasons,
            { label: 'Отношение ниже порога', value: rel.attitude < icfg.integrationMinAttitude ? -1 : 0 },
            { label: 'Обособленность выше порога', value: oc.isolation >= icfg.integrationIsolationGate ? -1 : 0 },
          ], { target: o, accepted: false });
        }
      }
      // Conflict.
      if (rel.status !== 'alliance' && rel.status !== 'patronage' && state.turn - rel.lastPeaceTurn >= icfg.truceTurns) {
        const contested = contestedLand(state, cloud.id, o, index);
        const ratioS = myStrength / (theirStrength + 1);
        if ((rel.attitude <= icfg.warMaxAttitude || (contested > 0.2 && w.conquest >= 0.6)) && ratioS > 1.15 && contested + Math.max(0, -rel.attitude) / 100 > 0.15) {
          // War is about land and grievances; superiority alone only lowers the risk.
          const V = 0.6 * contested + 0.25 * clamp(-rel.attitude / 50, 0, 1) + 0.15 * clamp(ratioS - 1, 0, 1) * (contested > 0.05 ? 1 : 0.2);
          // Past fighting between the two makes a new war look costlier.
          const memory = Math.min(1, rel.warTurns / 40);
          const treaty = hasTreaty(state, cloud.id, o) ? 0.5 : 0;
          const Rk = ch.riskAversion * (0.4 / ratioS + 0.15 + 0.6 * memory) + (rel.status === 'trade' ? 0.15 : 0) + treaty;
          add('war', w.conquest * V - Rk, [
            { label: 'Спорные земли', value: contested },
            { label: 'Соотношение сил', value: ratioS },
            { label: 'Неприязнь', value: -rel.attitude / 100 },
            { label: 'Память о прошлых войнах', value: -memory },
            { label: 'Действующий договор о границе', value: -treaty },
            { label: 'Вес завоевания (характер)', value: w.conquest },
          ]);
        }
      }
    }
    // Refusal to integrate when trade is clearly better (diagnostics).
    const integ = options.filter((p) => p.kind === 'integration');
    options.sort((a, b) => b.utility - a.utility || a.tiebreak - b.tiebreak);
    for (const p of integ) {
      if (p.utility < 0.08 || (options[0] !== p && options[0].utility > p.utility + 0.1)) {
        if (state.turn % 10 === cloud.id % 10) {
          const better = options[0] !== p ? options[0] : null;
          logDecision(state, cloud.id, 'integration', `${cloud.name} отказался интегрировать ${cloudName(state, p.target)}`, [
            ...p.reasons,
            ...(better ? [{ label: `Более выгодно: ${KIND_NAMES[better.kind]}`, value: better.utility }] : []),
            { label: 'Нагрузка / ёмкость', value: ratio },
          ], { target: p.target, accepted: false });
        }
      }
    }
    const max = state.config.sim.maxMajorActionsPerTurn;
    let taken = 0;
    for (const p of options) {
      if (taken >= max) break;
      if (p.utility < (p.kind === 'war' ? 0.15 : 0.08)) continue;
      proposals.push(p);
      taken++;
    }
  }
  return proposals;
}

export const KIND_NAMES: Record<ProposalKind, string> = {
  trade: 'торговля',
  alliance: 'союз',
  patronage: 'покровительство',
  integration: 'интеграция',
  war: 'конфликт',
  peace: 'мир',
};

export function isIntegrating(state: SimState, id: number): boolean {
  return state.relations.some((r) => r.integration?.target === id && state.clouds[r.a].alive && state.clouds[r.b].alive);
}

/** Security need of a cloud: hostile pressure relative to its own strength (0..1). */
export function securityNeed(state: SimState, id: number, index: CloudIndex, k: Knowledge): number {
  const mine = perceivedStrength(state, id, id, index, k);
  let threat = 0;
  for (const rel of relationsOf(state, id)) {
    const o = other(rel, id);
    if (rel.status === 'war' || rel.attitude < -25) threat += perceivedStrength(state, id, o, index, k);
  }
  return clamp(threat / (mine + threat + 1), 0, 1);
}

