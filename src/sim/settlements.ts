import { makeName } from './culture';
import { getGeo } from './geo';
import { cellLabel, logDecision, logEvent } from './log';
import { clamp } from './noise';
import { cellRural, cellTotal, cellUrban, dominantCloud, type CloudIndex } from './pop';
import type { Reason, Settlement, SettlementLevel, SimState } from './types';

/**
 * Settlements (turn stage 11) — a simplified central-place (Christaller /
 * Huff) model with three service tiers.
 *
 * Rural cells generate demand for each tier t:
 *     D_t(h) = rural_h · demandPerCapita_t · (1 + surplusDemandBoost · clamp(S_h / C_h, 0, 1))
 * Tier t is supplied only by settlements of level ≥ t+1 (villages: local
 * exchange; towns add crafts and markets; cities add administration and
 * long-distance trade). Within a tier, settlements compete with Huff weights
 *     attr_s(h) = levelAttraction_s · (1 + U_s/20)^sizeExponent · e^(−λ_t·d(s,h))
 *     share_s(h) = attr_s(h) / (Σ_s' attr_s'(h) + O)
 * where O is the outside option (self-sufficient households). Shares sum to
 * less than one, so the same demand is never served twice. Higher tiers have
 * low demand per person and a long range, so a city needs a large market
 * area and nearby cities split it: the network becomes hierarchical instead
 * of covering every cell.
 *
 * Non-farm jobs of a settlement = captured demand of the tiers it offers +
 * trade jobs (river/coast) + administrative jobs (state capital). Urban
 * population moves towards min(jobs, food-supported size).
 */
export interface ServiceInfo {
  /** Per tier: demand of each cell. */
  demand: number[][];
  /** Per tier: Huff shares of each cell. */
  shares: Array<Array<Array<{ s: number; share: number }>>>;
  /** Per tier: Σ attraction at each cell. */
  attrSum: number[][];
}

const LEVEL_NAMES = ['', 'деревня', 'городок', 'город'];
export const levelName = (l: number) => LEVEL_NAMES[l] ?? '';

function sizeFactor(state: SimState, s: Settlement): number {
  return Math.pow(1 + cellUrban(state.cells[s.hex]) / 20, state.config.settlements.sizeExponent);
}

function attraction(state: SimState, tier: number, level: number, size: number, cost: number): number {
  const cfg = state.config.settlements;
  return cfg.levelAttraction[level - 1] * size * Math.exp(-cfg.tiers[tier].lambda * cost);
}

export function tierDemand(state: SimState, idx: number, tier: number): number {
  const cfg = state.config.settlements;
  const cell = state.cells[idx];
  const rural = cellRural(cell);
  if (rural <= 0) return 0;
  const rich = cell.food.need > 0 ? clamp(cell.food.surplus / cell.food.need, 0, 1) : 0;
  return rural * cfg.tiers[tier].demandPerCapita * (1 + cfg.surplusDemandBoost * rich);
}

export function computeService(state: SimState): ServiceInfo {
  const geo = getGeo(state);
  const cfg = state.config.settlements;
  const n = state.cells.length;
  const T = cfg.tiers.length;
  const demand: number[][] = [];
  const shares: ServiceInfo['shares'] = [];
  const attrSum: number[][] = [];
  for (let t = 0; t < T; t++) {
    const d = new Array<number>(n);
    for (let i = 0; i < n; i++) d[i] = tierDemand(state, i, t);
    const attrs: Array<Array<{ s: number; a: number }>> = Array.from({ length: n }, () => []);
    const sum = new Array<number>(n).fill(0);
    for (const s of state.settlements) {
      if (!s.alive || s.level < t + 1) continue;
      const size = sizeFactor(state, s);
      for (const { idx, cost } of geo.serviceReach[s.hex]) {
        if (cost > cfg.tiers[t].radius) break;
        const a = attraction(state, t, s.level, size, cost);
        attrs[idx].push({ s: s.id, a });
        sum[idx] += a;
      }
    }
    demand.push(d);
    attrSum.push(sum);
    shares.push(attrs.map((list, idx) => list.map(({ s, a }) => ({ s, share: a / (sum[idx] + cfg.coverageScale) }))));
  }
  return { demand, shares, attrSum };
}

interface Potential {
  captured: number;
  servedPop: number;
  zoneSurplus: number;
}

/**
 * What a provider of `tier` at `hex` (existing settlement `self` promoted, or
 * a hypothetical new one) would capture against the current competitors.
 */
function potentialAt(state: SimState, info: ServiceInfo, hex: number, tier: number, level: number, size: number, self: Settlement | null): Potential {
  const geo = getGeo(state);
  const cfg = state.config.settlements;
  const fcfg = state.config.food;
  let captured = 0;
  let servedPop = 0;
  let zoneSurplus = 0;
  for (const { idx, cost } of geo.serviceReach[hex]) {
    if (cost > cfg.tiers[tier].radius) break;
    const a = attraction(state, tier, level, size, cost);
    let others = info.attrSum[tier][idx];
    if (self) {
      const mine = info.shares[tier][idx].find((x) => x.s === self.id);
      if (mine) others -= mine.share * (info.attrSum[tier][idx] + cfg.coverageScale);
    }
    const share = a / (Math.max(0, others) + a + cfg.coverageScale);
    captured += info.demand[tier][idx] * share;
    servedPop += cellRural(state.cells[idx]) * share;
    zoneSurplus += Math.max(0, state.cells[idx].food.surplus) * share * Math.exp(-fcfg.transportLambda * cost);
  }
  return { captured, servedPop, zoneSurplus };
}

/**
 * Transport position of a site: its own qualities (water, river, coast,
 * defence — the cell's appeal) mixed with market access, i.e. how many rural
 * people live within easy overland reach:
 *     access = clamp(0.6·appeal + 0.4·min(1, Σ rural_h·e^(−0.5·d) / 600) + river/coast bonus, 0, 1)
 */
export function transportPosition(state: SimState, hex: number): number {
  const geo = getGeo(state);
  const h = state.map.hexes[hex];
  let market = 0;
  for (const { idx, cost } of geo.serviceReach[hex]) {
    if (cost > 4) break;
    market += cellRural(state.cells[idx]) * Math.exp(-0.5 * cost);
  }
  return clamp(0.6 * h.appeal + 0.4 * Math.min(1, market / 600) + (h.river > 0 ? 0.1 : 0) + (h.coastal ? 0.05 : 0), 0, 1);
}

function tradeJobs(state: SimState, hex: number, level: number): number {
  const cfg = state.config.settlements;
  const h = state.map.hexes[hex];
  let jobs = 0;
  if (h.river > 0) jobs += cfg.tradeJobsRiver * Math.min(1, h.river / 4) * level;
  if (h.coastal) jobs += cfg.tradeJobsCoast * level;
  return jobs;
}

function adminJobs(state: SimState, s: Settlement): number {
  const pol = state.polities.find((p) => p.alive && p.capital === s.id);
  if (!pol) return 0;
  let cells = 0;
  for (const c of state.politics.control) if (c === pol.id) cells++;
  return state.config.settlements.adminJobsPerCell * cells;
}

export function runSettlements(state: SimState, index: CloudIndex): ServiceInfo {
  const cfg = state.config.settlements;
  for (const cell of state.cells) cell.popAvg = 0.85 * cell.popAvg + 0.15 * cellTotal(cell);

  let info = computeService(state);
  const T = cfg.tiers.length;
  const captured: number[][] = Array.from({ length: T }, () => new Array<number>(state.settlements.length).fill(0));
  const servedPop = new Array<number>(state.settlements.length).fill(0);
  for (let t = 0; t < T; t++) {
    info.shares[t].forEach((list, idx) => {
      const rural = cellRural(state.cells[idx]);
      for (const x of list) {
        captured[t][x.s] += info.demand[t][idx] * x.share;
        if (t === 0) servedPop[x.s] += rural * x.share;
      }
    });
  }

  // Jobs, supply and urban employment of existing settlements.
  for (const s of state.settlements) {
    if (!s.alive) continue;
    const cell = state.cells[s.hex];
    // A settlement belongs to the people who live in it.
    if (!cell.groups.some((g) => g.cloud === s.cloud)) {
      const owner = dominantCloud(cell, (id) => state.config.clouds.classes[state.clouds[id].cls].canSettle);
      if (owner >= 0) s.cloud = owner;
    }
    let jobs = 0;
    for (let t = 0; t < s.level; t++) jobs += captured[t][s.id];
    s.jobs = jobs + tradeJobs(state, s.hex, s.level) + adminJobs(state, s);
    s.servedPop = servedPop[s.id];
    s.supplyAvg = 0.8 * s.supplyAvg + 0.2 * cell.food.ratio;
    const U = cellUrban(cell);
    const foodLimit = s.supplyAvg < 0.97 ? U * s.supplyAvg * s.supplyAvg : Infinity;
    const target = Math.min(s.jobs, foodLimit);
    if (target > U) shiftOccupation(state, s.hex, Math.min(cfg.urbanizationRate * (target - U), cellRural(cell) * 0.5), true);
    else if (U > target) shiftOccupation(state, s.hex, cfg.deurbanizationRate * (U - target), false);
  }

  for (const s of state.settlements) {
    if (s.alive) evaluateLevel(state, info, s, captured[s.level - 1][s.id]);
  }

  info = computeService(state);
  foundVillages(state, info, index);
  for (const cell of state.cells) cell.zone = -1;
  info.shares[0].forEach((list, idx) => {
    let best = -1;
    let bestShare = 0.15;
    for (const x of list) {
      if (x.share > bestShare) {
        bestShare = x.share;
        best = x.s;
      }
    }
    state.cells[idx].zone = best;
  });
  return info;
}

/** Move people between rural and urban occupation on one cell (same people, numbers unchanged). */
function shiftOccupation(state: SimState, hex: number, amount: number, toUrban: boolean): void {
  if (amount <= 0) return;
  const cell = state.cells[hex];
  const pool = toUrban ? cellRural(cell) : cellUrban(cell);
  if (pool <= 0) return;
  const f = Math.min(1, amount / pool);
  for (const g of cell.groups) {
    const d = (toUrban ? g.rural : g.urban) * f;
    if (toUrban) {
      g.rural -= d;
      g.urban += d;
    } else {
      g.urban -= d;
      g.rural += d;
    }
  }
}

function evaluateLevel(state: SimState, info: ServiceInfo, s: Settlement, ownTierCaptured: number): void {
  const cfg = state.config.settlements;
  const cell = state.cells[s.hex];
  const U = cellUrban(cell);
  const N = cellTotal(cell);

  if (s.level < 3) {
    const next = (s.level + 1) as SettlementLevel;
    const req = next === 2 ? cfg.town : cfg.city;
    // The new tier this settlement would start to offer.
    const pot = potentialAt(state, info, s.hex, next - 1, next, sizeFactor(state, s), null);
    s.potentialJobs = pot.captured;
    s.zoneSurplus = pot.zoneSurplus;
    const access = transportPosition(state, s.hex);
    // Existing centres of the next level must not already serve this very place well.
    const ownFree = cfg.coverageScale / (info.attrSum[next - 1][s.hex] + cfg.coverageScale);
    const checks: Array<[boolean, string]> = [
      [ownFree >= 0.4, `место уже обслуживается соседним центром (свободная доля ${ownFree.toFixed(2)} < 0.4)`],
      [s.supplyAvg >= req.minSupply, `снабжение ${s.supplyAvg.toFixed(3)} < ${req.minSupply}`],
      [pot.servedPop >= req.minServed, `обслуживаемое население ${Math.round(pot.servedPop)} < ${req.minServed}`],
      [U >= req.minUrban && U >= s.jobs * 0.85, `занятость вне с/х: горожан ${Math.round(U)}, рабочих мест ${Math.round(s.jobs)} (нужно ≥ ${req.minUrban})`],
      [N > 0 && U / N >= req.minNonAgri, `доля несельскохозяйственной занятости ${(N > 0 ? U / N : 0).toFixed(2)} < ${req.minNonAgri}`],
      [access >= req.minAppeal, `транспортная позиция ${access.toFixed(2)} < ${req.minAppeal}`],
      [pot.captured >= req.minJobs, `спрос на услуги нового уровня ${Math.round(pot.captured)} < ${req.minJobs}`],
      [pot.zoneSurplus >= req.minSurplus, `доступный избыток пищи ${Math.round(pot.zoneSurplus)} < ${req.minSurplus}`],
    ];
    const failed = checks.filter(([ok]) => !ok).map(([, why]) => why);
    s.blockers = failed;
    if (failed.length === 0) s.upStreak++;
    else {
      if (failed.length <= 2 && s.upStreak > 2) {
        logDecision(state, s.cloud, 'settlement_upgrade', `Отказ в повышении: ${s.name} (${levelName(s.level)}) после ${s.upStreak} ходов роста`,
          failed.map((f) => ({ label: f, value: -1 })), { hex: s.hex, accepted: false });
      }
      s.upStreak = 0;
    }
    if (s.upStreak >= cfg.upgradeTurns) {
      s.level = next;
      s.upStreak = 0;
      s.downStreak = 0;
      if (next > s.peakLevel) s.peakLevel = next;
      const reasons: Reason[] = [
        { label: 'Устойчивое снабжение', value: s.supplyAvg },
        { label: 'Обслуживаемое население', value: pot.servedPop },
        { label: 'Спрос на услуги нового уровня', value: pot.captured },
        { label: 'Доступный избыток пищи', value: pot.zoneSurplus },
        { label: 'Горожане', value: U },
        { label: 'Транспортная позиция', value: access },
      ];
      logDecision(state, s.cloud, 'settlement_upgrade', `${s.name} стал ${next === 2 ? 'городком' : 'городом'}`, reasons, { hex: s.hex });
      logEvent(state, 'settlement_up', [s.cloud], `${cfg.upgradeTurns} ходов подряд выполнены все условия роста`,
        `${s.name} ${cellLabel(state, s.hex)} вырос до уровня «${levelName(next)}»`, s.hex);
      return;
    }
  } else s.blockers = [];

  // Decline: the settlement's own top tier no longer has a market, or food fails.
  const minCaptured = s.level === 1 ? cfg.village.minCaptured : s.level === 2 ? cfg.town.minJobs : cfg.city.minJobs;
  const weakSupply = s.supplyAvg < cfg.declineSupply;
  const weakJobs = ownTierCaptured < minCaptured * cfg.declineJobsRatio;
  const deserted = s.level === 1 && N < cfg.village.minPop * 0.4;
  if (weakSupply || weakJobs || deserted) s.downStreak++;
  else s.downStreak = Math.max(0, s.downStreak - 1);
  if (s.downStreak >= cfg.declineTurns) {
    const why = [weakSupply ? 'нехватка продовольствия' : '', weakJobs ? 'потеря рынка услуг' : '', deserted ? 'уход населения' : '']
      .filter(Boolean).join(', ');
    s.downStreak = 0;
    logDecision(state, s.cloud, 'settlement_upgrade', `Упадок: ${s.name} (${levelName(s.level)})`, [
      { label: 'Среднее снабжение', value: s.supplyAvg },
      { label: 'Спрос на услуги своего уровня', value: ownTierCaptured },
      { label: 'Население клетки', value: N },
    ], { hex: s.hex, accepted: false });
    if (s.level === 1) {
      s.alive = false;
      s.abandonedTurn = state.turn;
      shiftOccupation(state, s.hex, cellUrban(cell), false);
      cell.settlement = -1;
      logEvent(state, 'settlement_abandoned', [s.cloud], why, `${s.name} ${cellLabel(state, s.hex)} перестал быть поселением; жители перешли к сельским занятиям`, s.hex);
    } else {
      s.level = (s.level - 1) as SettlementLevel;
      logEvent(state, 'settlement_down', [s.cloud], why, `${s.name} ${cellLabel(state, s.hex)} пришёл в упадок до уровня «${levelName(s.level)}»`, s.hex);
    }
  }
}

function foundVillages(state: SimState, info: ServiceInfo, index: CloudIndex): void {
  const cfg = state.config.settlements;
  const vcfg = cfg.village;
  const geo = getGeo(state);
  const fcfg = state.config.food;
  const O = cfg.coverageScale;
  type Cand = { idx: number; cloud: number; score: number; reasons: Reason[] };
  const best = new Map<number, Cand>();
  for (let idx = 0; idx < state.cells.length; idx++) {
    const cell = state.cells[idx];
    if (cell.settlement >= 0) continue;
    const hex = state.map.hexes[idx];
    const N = cellTotal(cell);
    // (1) stable population and (2) a favourable site.
    if (cell.popAvg < vcfg.minPop || N < 0.9 * cell.popAvg) continue;
    if (hex.appeal < vcfg.minAppeal) continue;
    // (6) only medium and large clouds found settlements.
    const founder = dominantCloud(cell, (id) => state.config.clouds.classes[state.clouds[id].cls].canSettle);
    if (founder < 0 || !index.cells[founder]) continue;
    if (state.turn - state.clouds[founder].lastFoundingTurn < cfg.foundingCooldown) continue;
    // (5) existing centres must not already serve this place well.
    const ownFree = O / (info.attrSum[0][idx] + O);
    if (ownFree < vcfg.minFreeShare) continue;
    // (3) available surplus and (4) unserved demand around the site.
    let surplus = 0;
    let unserved = 0;
    for (const { idx: h, cost } of geo.serviceReach[idx]) {
      if (cost > cfg.tiers[0].radius) break;
      const freeShare = O / (info.attrSum[0][h] + O);
      surplus += Math.max(0, state.cells[h].food.surplus) * Math.exp(-fcfg.transportLambda * cost) * freeShare;
      unserved += info.demand[0][h] * freeShare * Math.exp(-cfg.tiers[0].lambda * cost);
    }
    if (surplus < vcfg.minSurplus || unserved < vcfg.minUnserved) continue;
    // (5b) a new centre must capture enough demand against existing ones.
    const pot = potentialAt(state, info, idx, 0, 1, 1, null);
    if (pot.captured < vcfg.minCaptured) continue;
    const score = pot.captured * (0.5 + hex.appeal);
    const reasons: Reason[] = [
      { label: 'Устойчивое население', value: cell.popAvg },
      { label: 'Привлекательность места', value: hex.appeal },
      { label: 'Доступный избыток пищи вокруг', value: surplus },
      { label: 'Неудовлетворённый спрос на услуги', value: unserved },
      { label: 'Захватываемый спрос (с учётом конкурентов)', value: pot.captured },
      { label: 'Доля спроса места вне зон других центров', value: ownFree },
      { label: 'Пресная вода', value: hex.freshWater },
      { label: 'Река', value: hex.river > 0 ? 1 : 0 },
    ];
    const prev = best.get(founder);
    if (!prev || prev.score < score) best.set(founder, { idx, cloud: founder, score, reasons });
  }
  // One founding per cloud per turn; nearby candidates of different clouds compete by score.
  const chosen = [...best.values()].sort((a, b) => b.score - a.score || a.idx - b.idx);
  const taken: number[] = [];
  for (const c of chosen) {
    if (taken.some((t) => hexDistance(state, t, c.idx) <= 2)) continue;
    taken.push(c.idx);
    const s: Settlement = {
      id: state.settlements.length,
      name: makeName(state.rng),
      hex: c.idx,
      level: 1,
      cloud: c.cloud,
      foundedTurn: state.turn,
      alive: true,
      abandonedTurn: -1,
      upStreak: 0,
      downStreak: 0,
      supplyAvg: state.cells[c.idx].food.ratio,
      jobs: 0,
      servedPop: 0,
      potentialJobs: 0,
      zoneSurplus: 0,
      peakLevel: 1,
      blockers: [],
    };
    state.settlements.push(s);
    state.cells[c.idx].settlement = s.id;
    state.clouds[c.cloud].lastFoundingTurn = state.turn;
    state.counters.settlementsFounded++;
    shiftOccupation(state, c.idx, Math.min(5, cellRural(state.cells[c.idx]) * 0.1), true);
    const h = state.map.hexes[c.idx];
    logDecision(state, c.cloud, 'settlement', `${state.clouds[c.cloud].name} основал деревню ${s.name} ${cellLabel(state, c.idx)}`, c.reasons, { hex: c.idx });
    logEvent(state, 'settlement', [c.cloud], 'Недообслуженный спрос, избыток пищи и удобное место',
      `Возникла деревня ${s.name} на гексе ${cellLabel(state, c.idx)} (${state.config.map.terrains[h.terrain].name.toLowerCase()})`, c.idx);
  }
}

function hexDistance(state: SimState, a: number, b: number): number {
  const ha = state.map.hexes[a];
  const hb = state.map.hexes[b];
  const dq = ha.q - hb.q;
  const dr = ha.r - hb.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
