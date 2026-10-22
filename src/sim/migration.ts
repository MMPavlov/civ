import { effectiveCapacity } from './demography';
import { getGeo } from './geo';
import { cellLabel, logDecision } from './log';
import { addPop, cellTotal, compactCell, type CloudIndex } from './pop';
import { getRelation } from './relations';
import type { Cloud, PopGroup, Reason, SimState } from './types';

/**
 * Migration between neighbouring cells (turn stage 6).
 *
 * Outflow share of a group: m = base·pressure + drive, where
 *   pressure = max(0, (N/K − c0)/(1 − c0)) + faminePush·(1 − φ)
 *   base     = migrationRate · race.migration · class.migration
 *   drive    = expansion drive of the cloud's character/strategy (only if
 *              there is attractive free land next to the cell).
 * Destinations (adjacent, passable, habitable) and "stay" are scored and the
 * outflow is split with a softmax over the scores. All flows are computed
 * from the same snapshot and then applied together: migration only moves
 * people, it never creates or destroys them.
 */
export interface MigrationFlow {
  from: number;
  to: number;
  cloud: number;
  race: number;
  culture: number;
  amount: number;
  newCell: boolean;
}

export function scoreTarget(
  state: SimState,
  cloud: Cloud,
  raceId: number,
  t: number,
  isOrigin: boolean,
): { score: number; reasons: Reason[] } {
  const hex = state.map.hexes[t];
  const cell = state.cells[t];
  const race = state.races[raceId];
  const K = Math.max(1, effectiveCapacity(state, t));
  const N = cellTotal(cell);
  let own = 0;
  let friend = 0;
  let hostile = 0;
  let stranger = 0;
  for (const g of cell.groups) {
    const n = g.rural + g.urban;
    if (g.cloud === cloud.id) {
      own += n;
      continue;
    }
    const rel = getRelation(state, cloud.id, g.cloud);
    if (!rel) stranger += n;
    else if (rel.status === 'war') hostile += n;
    else if (rel.status === 'alliance' || rel.status === 'trade' || rel.status === 'patronage' || rel.attitude > 30) friend += n;
    else stranger += n;
  }
  const share = (x: number) => (N > 0 ? x / N : 0);
  const free = (K - N) / K;
  const food = cell.food.need > 0 ? cell.food.ratio - 1 : 0;
  const perm = state.config.map.terrains[hex.terrain].permeability;
  const aff = race.affinity[hex.terrain] ?? 1;
  const ch = state.config.clouds.characters[cloud.character];
  const expandW = ch.weights.expand * (cloud.strategy === 'expand' ? 1.4 : cloud.strategy === 'consolidate' || cloud.strategy === 'isolate' ? 0.4 : 0.8);
  const sid = cell.settlement;
  const settlementPull = sid >= 0 && state.settlements[sid].alive ? 0.12 * state.settlements[sid].level : 0;

  const reasons: Reason[] = [
    { label: 'Свободная вместимость', value: 1.2 * free },
    { label: 'Обеспеченность пищей', value: 0.8 * food },
    { label: 'Проницаемость местности', value: 0.4 * Math.log(Math.max(perm, 0.05)) },
    { label: 'Расовая приспособленность', value: 0.8 * (aff - 1) },
    { label: 'Пресная вода', value: 0.25 * hex.freshWater },
    { label: 'Предпочтение экспансии', value: !isOrigin && own === 0 ? 0.35 * expandW : 0 },
    { label: 'Присутствие своих', value: cloud.strategy === 'consolidate' ? 0.3 * share(own) : 0.1 * share(own) },
    { label: 'Дружественные общности', value: 0.25 * share(friend) },
    { label: 'Враждебные общности', value: -1.0 * share(hostile) },
    { label: 'Чужие общности', value: -0.3 * share(stranger) * (0.4 + cloud.isolation / 100 + ch.weights.autonomy * 0.4) },
    { label: 'Притяжение поселения', value: settlementPull },
  ];
  let score = 0;
  for (const r of reasons) score += r.value;
  return { score, reasons };
}

export function runMigration(state: SimState, index: CloudIndex): MigrationFlow[] {
  const cfg = state.config.demography;
  const geo = getGeo(state);
  const flows: MigrationFlow[] = [];
  const bestNew = new Map<number, { flow: MigrationFlow; reasons: Reason[]; score: number }>();

  for (let idx = 0; idx < state.cells.length; idx++) {
    const cell = state.cells[idx];
    if (!cell.groups.length) continue;
    const N = cellTotal(cell);
    const K = Math.max(1, effectiveCapacity(state, idx));
    const crowd = N / K;
    const phi = cell.food.ratio;
    const pressure = Math.max(0, (crowd - cfg.crowdingStart) / (1 - cfg.crowdingStart)) + cfg.faminePush * (1 - phi);
    for (const g of cell.groups) {
      const n = g.rural + g.urban;
      if (n < 2) continue;
      const cloud = state.clouds[g.cloud];
      const race = state.races[g.race];
      const cls = state.config.clouds.classes[cloud.cls];
      const ch = state.config.clouds.characters[cloud.character];
      const base = cfg.migrationRate * race.migration * cls.migration;
      const area = index.cells[cloud.id].length;
      const atLimit = cloud.maxArea > 0 && area >= cloud.maxArea;

      const stay = scoreTarget(state, cloud, g.race, idx, true);
      const options: Array<{ t: number; score: number; reasons: Reason[]; isNew: boolean }> = [];
      for (const t of geo.neighbors[idx]) {
        const hex = state.map.hexes[t];
        if (hex.capacity <= 0 || !Number.isFinite(hex.moveCost)) continue;
        if (!cloud.explored[t]) continue;
        const isNew = !state.cells[t].groups.some((x) => x.cloud === cloud.id);
        if (isNew && atLimit) continue;
        const s = scoreTarget(state, cloud, g.race, t, false);
        options.push({ t, score: s.score, reasons: s.reasons, isNew });
      }
      if (!options.length) continue;
      const bestScore = Math.max(...options.map((o) => o.score));
      const driveWanted = bestScore > stay.score + 0.15 && options.some((o) => o.isNew && o.score === bestScore);
      const drive = driveWanted
        ? cfg.expansionDrive * ch.weights.expand * (cloud.strategy === 'expand' ? 1.5 : 0.6) * cls.migration
        : 0;
      const m = Math.min(0.3, base * pressure + drive);
      if (m <= 1e-4) continue;

      const T = cfg.softmaxTemperature;
      const stayW = Math.exp((stay.score + cfg.stayBias - bestScore) / T);
      const ws = options.map((o) => Math.exp((o.score - bestScore) / T));
      const total = stayW + ws.reduce((a, b) => a + b, 0);
      const movers = n * m;
      // A pioneer group: the most attractive new cell gets at least pioneerSize settlers.
      const pioneer = driveWanted && n >= 3 * cfg.pioneerSize
        ? options.reduce((b, o) => (o.isNew && (b === null || o.score > b.score) ? o : b), null as (typeof options)[number] | null)
        : null;
      options.forEach((o, k) => {
        let amount = (movers * ws[k]) / total;
        if (o === pioneer) amount = Math.max(amount, Math.min(cfg.pioneerSize, 0.25 * n));
        if (amount < 0.05) return;
        if (o.isNew && amount < cfg.minSeed) return; // too few to found a new community
        const flow: MigrationFlow = { from: idx, to: o.t, cloud: g.cloud, race: g.race, culture: g.culture, amount, newCell: o.isNew };
        flows.push(flow);
        if (o.isNew && cloud.cls !== 'small') {
          const prev = bestNew.get(cloud.id);
          if (!prev || prev.flow.amount < amount) bestNew.set(cloud.id, { flow, reasons: o.reasons, score: o.score });
        }
      });
    }
  }

  flows.push(...exchangeFlows(state));

  // Small clouds: only (maxArea − area) new cells may be entered; keep the strongest.
  const accepted = enforceAreaLimits(state, index, flows);

  // Apply: take from source groups proportionally to rural/urban shares, arrive as rural.
  const outflow = new Map<PopGroup, number>();
  for (const f of accepted) {
    const g = state.cells[f.from].groups.find((x) => x.cloud === f.cloud && x.race === f.race && x.culture === f.culture)!;
    outflow.set(g, (outflow.get(g) ?? 0) + f.amount);
  }
  // Never move more than a group has (cannot happen with m ≤ 0.3, kept as a guard).
  const scaleFor = new Map<PopGroup, number>();
  for (const [g, out] of outflow) {
    const n = g.rural + g.urban;
    scaleFor.set(g, out > n ? n / out : 1);
  }
  // Phase A: every departure is taken from the pre-migration snapshot of its group.
  const shares = new Map<PopGroup, { rural: number; n: number }>();
  for (const g of outflow.keys()) shares.set(g, { rural: g.rural, n: g.rural + g.urban });
  for (const f of accepted) {
    const g = state.cells[f.from].groups.find((x) => x.cloud === f.cloud && x.race === f.race && x.culture === f.culture)!;
    const snap = shares.get(g)!;
    f.amount *= scaleFor.get(g)!;
    const ruralTake = f.amount * (snap.n > 0 ? snap.rural / snap.n : 1);
    g.rural -= ruralTake;
    g.urban -= f.amount - ruralTake;
    if (g.rural < 0) {
      g.urban += g.rural;
      g.rural = 0;
    }
    if (g.urban < 0) {
      g.rural += g.urban;
      g.urban = 0;
    }
  }
  // Phase B: arrivals.
  for (const f of accepted) addPop(state.cells[f.to], f.cloud, f.race, f.culture, f.amount, 0);
  for (const f of accepted) {
    compactCell(state.cells[f.from]);
    compactCell(state.cells[f.to]);
  }

  if (state.config.sim.logMigrationDecisions) {
    for (const [cloudId, best] of bestNew) {
      if (!accepted.includes(best.flow) || best.flow.amount < 1) continue;
      logDecision(
        state,
        cloudId,
        'migration',
        `${state.clouds[cloudId].name} направил миграцию на гекс ${cellLabel(state, best.flow.to)}`,
        best.reasons,
        { hex: best.flow.to, accepted: true },
      );
    }
  }
  return accepted;
}

/**
 * Everyday exchange across a contact zone (marriages, trade, seasonal moves):
 * neighbouring communities of different peoples at peace swap the same
 * number of people x = exchangeRate · min(N_i, N_j) · compatibility in both
 * directions. Cell totals stay the same; compositions mix. Small clouds take
 * part only on cells they already occupy.
 */
function exchangeFlows(state: SimState): MigrationFlow[] {
  const rate = state.config.demography.exchangeRate;
  if (rate <= 0) return [];
  const geo = getGeo(state);
  const out: MigrationFlow[] = [];
  const dominant = state.cells.map((c) => {
    let best = -1;
    let bestN = 0;
    const totals = new Map<number, number>();
    for (const g of c.groups) totals.set(g.cloud, (totals.get(g.cloud) ?? 0) + g.rural + g.urban);
    for (const [id, n] of totals) if (n > bestN || (n === bestN && id < best)) [best, bestN] = [id, n];
    return best;
  });
  for (let i = 0; i < state.cells.length; i++) {
    const a = dominant[i];
    if (a < 0) continue;
    for (const j of geo.neighbors[i]) {
      if (j < i) continue;
      const b = dominant[j];
      if (b < 0 || b === a) continue;
      const rel = getRelation(state, a, b);
      if (!rel || rel.status === 'war') continue;
      const compat = rel.status === 'trade' || rel.status === 'alliance' || rel.status === 'patronage' ? 1 : 0.5;
      const eligible = (from: number, to: number) =>
        state.cells[from].groups.filter((g) => {
          const c = state.clouds[g.cloud];
          return g.rural + g.urban > 0 && (c.maxArea <= 0 || state.cells[to].groups.some((h) => h.cloud === g.cloud));
        });
      const gi = eligible(i, j);
      const gj = eligible(j, i);
      const ni = gi.reduce((s, g) => s + g.rural + g.urban, 0);
      const nj = gj.reduce((s, g) => s + g.rural + g.urban, 0);
      const x = rate * compat * Math.min(ni, nj);
      if (x < 0.2) continue;
      for (const [groups, n, from, to] of [[gi, ni, i, j], [gj, nj, j, i]] as const) {
        for (const g of groups) {
          const amount = (x * (g.rural + g.urban)) / n;
          if (amount < 0.02) continue;
          const isNew = !state.cells[to].groups.some((h) => h.cloud === g.cloud);
          out.push({ from, to, cloud: g.cloud, race: g.race, culture: g.culture, amount, newCell: isNew });
        }
      }
    }
  }
  return out;
}

function enforceAreaLimits(state: SimState, index: CloudIndex, flows: MigrationFlow[]): MigrationFlow[] {
  const blocked = new Set<MigrationFlow>();
  const byCloud = new Map<number, Map<number, number>>();
  for (const f of flows) {
    if (!f.newCell) continue;
    const cloud = state.clouds[f.cloud];
    if (cloud.maxArea <= 0) continue;
    let m = byCloud.get(f.cloud);
    if (!m) byCloud.set(f.cloud, (m = new Map()));
    m.set(f.to, (m.get(f.to) ?? 0) + f.amount);
  }
  for (const [cloudId, targets] of byCloud) {
    const cloud = state.clouds[cloudId];
    const allowed = Math.max(0, cloud.maxArea - index.cells[cloudId].length);
    const ranked = [...targets.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const ok = new Set(ranked.slice(0, allowed).map(([t]) => t));
    for (const f of flows) if (f.cloud === cloudId && f.newCell && !ok.has(f.to)) blocked.add(f);
  }
  return flows.filter((f) => !blocked.has(f));
}
