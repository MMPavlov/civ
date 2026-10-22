import { cloudStrength } from './ai';
import { dijkstra, getGeo } from './geo';
import { declareWar } from './interactions';
import { cellLabel, logDecision, logEvent } from './log';
import { clamp } from './noise';
import { cellTotal, cloudPopOnCell, type CloudIndex } from './pop';
import { getRelation } from './relations';
import type { ServiceInfo } from './settlements';
import { NEUTRAL, SHARED, type Claim, type Negotiation, type Polity, type Reason, type SimState, type Treaty, type TreatyKind } from './types';

/**
 * Territorial claims and negotiated borders (turn stage 13).
 *
 * Claim of polity p on cell h (only within administrative reach of its
 * settlements, which grows with institutions):
 *   s = w_pop·popShare + w_prox·proximity + w_econ·serviceShare + w_access·access + w_strat·strategic
 * Claims may overlap and do not by themselves assign the cell. A single
 * claim above controlThreshold gives de-facto control (uncontested).
 * Overlapping claims make a dispute; the two polities negotiate a partition
 * algorithmically: natural line by claim strength, neutral strips where
 * claims are nearly equal and land is empty, shared use where both peoples
 * live and relations are good, and value-improving swaps (exchange). Each
 * side accepts if the deal is worth at least as much as continuing the
 * dispute or going to war (estimated from strength, risk aversion and
 * relations). Treaties are sticky: they are reopened only after
 * treatyMinDuration turns and a large shift of claims, or after major events
 * (war, schism, collapse). Politics never changes the culture of people.
 */
export function runBorders(state: SimState, index: CloudIndex, info: ServiceInfo): void {
  const cfg = state.config.states;
  const p = state.politics;
  const n = state.cells.length;
  const polities = state.polities.filter((x) => x.alive);
  for (let i = 0; i < n; i++) {
    p.claims[i] = [];
    p.control[i] = -1;
    p.recognized[i] = -1;
    p.sharedBy[i] = null;
    p.disputed[i] = false;
  }
  for (const t of state.treaties) if (t.alive && (!state.polities[t.a].alive || !state.polities[t.b].alive)) endTreaty(state, t, 'Один из участников прекратил существование');
  if (!polities.length) return;

  computeClaims(state, polities, info);

  // Treaty assignments (sticky), keyed by cell.
  const treatyAt = new Map<number, { t: Treaty; owner: number }>();
  for (const t of state.treaties) {
    if (!t.alive) continue;
    for (const c of t.cells) treatyAt.set(c.idx, { t, owner: c.owner });
  }

  const contested = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const claims = p.claims[i];
    if (!claims.length) continue;
    const tr = treatyAt.get(i);
    if (tr && claims.some((c) => c.p === tr.t.a || c.p === tr.t.b)) {
      p.recognized[i] = tr.owner;
      if (tr.owner >= 0) p.control[i] = tr.owner;
      if (tr.owner === SHARED) p.sharedBy[i] = [tr.t.a, tr.t.b];
      continue;
    }
    const top = claims[0];
    const second = claims[1];
    if (!second) {
      if (top.s >= cfg.controlThreshold) {
        p.control[i] = top.p;
        p.recognized[i] = top.p;
      }
      continue;
    }
    p.disputed[i] = true;
    if (top.s - second.s > 0.1 && top.s >= cfg.controlThreshold) p.control[i] = top.p;
    const key = top.p < second.p ? `${top.p}:${second.p}` : `${second.p}:${top.p}`;
    const list = contested.get(key) ?? [];
    list.push(i);
    contested.set(key, list);
  }

  reviewTreaties(state);

  for (const key of [...contested.keys()].sort()) {
    const [a, b] = key.split(':').map(Number);
    negotiate(state, state.polities[a], state.polities[b], contested.get(key)!, index);
  }
  for (const neg of state.negotiations) {
    if (neg.open && !contested.has(`${Math.min(neg.a, neg.b)}:${Math.max(neg.a, neg.b)}`)) neg.open = false;
  }
}

function computeClaims(state: SimState, polities: Polity[], info: ServiceInfo): void {
  const cfg = state.config.states;
  const w = cfg.claimWeights;
  const geo = getGeo(state);
  const p = state.politics;
  for (const pol of polities) {
    const cloud = state.clouds[pol.cloud];
    const radius = cfg.adminRadiusBase + cfg.adminRadiusPerInstitution * cloud.institutions;
    const capital = state.settlements[pol.capital];
    const fromCapital = new Map<number, number>();
    for (const { idx, cost } of dijkstra(capital.hex, geo.neighbors, geo.edgeCost, radius)) fromCapital.set(idx, cost);
    const proximity = new Map<number, number>();
    for (const s of state.settlements) {
      if (!s.alive || s.cloud !== pol.cloud) continue;
      const factor = s.id === pol.capital ? 1 : s.level === 3 ? 0.85 : s.level === 2 ? 0.7 : 0.4;
      const r = radius * (s.id === pol.capital ? 1 : 0.35 + 0.15 * s.level);
      for (const { idx, cost } of dijkstra(s.hex, geo.neighbors, geo.edgeCost, r)) {
        const v = factor * Math.exp((-2 * cost) / radius);
        if (v > (proximity.get(idx) ?? 0)) proximity.set(idx, v);
      }
    }
    const ownSettlements = new Set(state.settlements.filter((s) => s.alive && s.cloud === pol.cloud).map((s) => s.id));
    for (const [idx, prox] of proximity) {
      const hex = state.map.hexes[idx];
      if (hex.terrain === 'ocean' || hex.terrain === 'lake') continue;
      const N = cellTotal(state.cells[idx]);
      const popShare = N > 0 ? cloudPopOnCell(state.cells[idx], pol.cloud) / N : 0;
      // Economic tie: the strongest service share of the polity's settlements over all tiers.
      let econ = 0;
      for (const tier of info.shares) for (const x of tier[idx]) if (ownSettlements.has(x.s)) econ = Math.max(econ, x.share);
      const cc = fromCapital.get(idx);
      const access = cc === undefined ? 0 : clamp(1 - cc / radius, 0, 1);
      const passable = geo.edgeCost[idx].filter((c) => Number.isFinite(c)).length;
      // Passes (few passable neighbours), rivers and defensible ground are worth claiming.
      const strategic = clamp(hex.defense * 0.5 + (hex.river > 0 ? 0.25 : 0) + (passable <= 3 ? 0.45 : 0), 0, 1);
      const s = w.population * popShare + w.proximity * prox + w.economy * clamp(econ * 2, 0, 1) + w.access * access +
        w.strategic * strategic * (popShare > 0 || prox > 0.3 ? 1 : 0.3);
      if (s >= cfg.claimThreshold) p.claims[idx].push({ p: pol.id, s });
    }
  }
  for (const list of p.claims) list.sort((x: Claim, y: Claim) => y.s - x.s || x.p - y.p);
}

function claimOf(state: SimState, idx: number, pol: number): number {
  return state.politics.claims[idx].find((c) => c.p === pol)?.s ?? 0;
}

/** Re-open treaties only after their minimum duration and a large shift of claims. */
function reviewTreaties(state: SimState): void {
  const cfg = state.config.states;
  for (const t of state.treaties) {
    if (!t.alive || state.turn - t.turn < cfg.treatyMinDuration) continue;
    let shift = 0;
    for (const b of t.baseline) {
      const now = claimOf(state, b.idx, t.a) - claimOf(state, b.idx, t.b);
      shift += Math.abs(now - (b.sa - b.sb));
    }
    shift /= Math.max(1, t.baseline.length);
    if (shift > cfg.reviewThreshold) endTreaty(state, t, `Существенное изменение претензий (${shift.toFixed(2)})`);
  }
}

function endTreaty(state: SimState, t: Treaty, why: string): void {
  t.alive = false;
  t.endedTurn = state.turn;
  t.endReason = why;
  const ca = state.polities[t.a].cloud;
  const cb = state.polities[t.b].cloud;
  logEvent(state, 'treaty_broken', [ca, cb], why, `Договор о границе между «${state.polities[t.a].name}» и «${state.polities[t.b].name}» пересматривается`);
  logDecision(state, ca, 'border', 'Пересмотр границы', [{ label: why, value: 1 }], { target: cb, accepted: false });
}

function cellValue(state: SimState, idx: number): number {
  const h = state.map.hexes[idx];
  const sid = state.cells[idx].settlement;
  const level = sid >= 0 && state.settlements[sid].alive ? state.settlements[sid].level : 0;
  return 0.2 + h.agriPotential / 180 + level * 0.8 + 0.3 * h.appeal;
}

function negotiate(state: SimState, A: Polity, B: Polity, cells: number[], index: CloudIndex): void {
  const cfg = state.config.states;
  const ca = state.clouds[A.cloud];
  const cb = state.clouds[B.cloud];
  const rel = getRelation(state, ca.id, cb.id);
  let neg = state.negotiations.find((x) => (x.a === A.id && x.b === B.id) || (x.a === B.id && x.b === A.id));
  if (!neg) {
    neg = { a: A.id, b: B.id, startTurn: state.turn, lastRoundTurn: -999, rounds: 0, open: true } as Negotiation;
    state.negotiations.push(neg);
    logEvent(state, 'dispute', [ca.id, cb.id], `Пересекающиеся претензии на ${cells.length} гекс(ов)`,
      `Возник территориальный спор между «${A.name}» и «${B.name}»`, cells[0]);
  }
  if (rel?.status === 'war') return;
  if (!neg.open) {
    neg.open = true;
    neg.startTurn = state.turn;
    neg.rounds = 0;
  }
  if (state.turn - neg.lastRoundTurn < cfg.negotiationCooldown) return;
  neg.lastRoundTurn = state.turn;
  neg.rounds++;
  if (neg.rounds === 1) {
    logEvent(state, 'negotiation', [ca.id, cb.id], `Спорные гексы: ${cells.length}`, `«${A.name}» и «${B.name}» начали переговоры о границе`, cells[0]);
  }

  const attitude = rel?.attitude ?? 0;
  // Proposed partition.
  const alloc: Array<{ idx: number; owner: number; va: number; vb: number; sa: number; sb: number }> = [];
  const kinds = new Set<TreatyKind>(['border']);
  for (const idx of cells) {
    const sa = claimOf(state, idx, A.id);
    const sb = claimOf(state, idx, B.id);
    const N = cellTotal(state.cells[idx]);
    const pa = N > 0 ? cloudPopOnCell(state.cells[idx], ca.id) / N : 0;
    const pb = N > 0 ? cloudPopOnCell(state.cells[idx], cb.id) / N : 0;
    const v = cellValue(state, idx);
    const va = v * (0.5 + pa) * sa;
    const vb = v * (0.5 + pb) * sb;
    let owner: number;
    if (pa >= cfg.sharedMinMix && pb >= cfg.sharedMinMix && attitude >= cfg.sharedMinAttitude) owner = SHARED;
    else if (Math.abs(sa - sb) < cfg.neutralEpsilon && pa + pb < cfg.sharedMinMix) owner = NEUTRAL;
    else owner = sa >= sb ? A.id : B.id;
    alloc.push({ idx, owner, va, vb, sa, sb });
  }
  // Value-improving swaps: a cell each side values more on the other's side of the line.
  const aWants = alloc.filter((x) => x.owner === B.id && x.va > x.vb * 1.3).sort((x, y) => y.va - y.vb - (x.va - x.vb));
  const bWants = alloc.filter((x) => x.owner === A.id && x.vb > x.va * 1.3).sort((x, y) => y.vb - y.va - (x.vb - x.va));
  for (let k = 0; k < Math.min(aWants.length, bWants.length); k++) {
    aWants[k].owner = A.id;
    bWants[k].owner = B.id;
    kinds.add('exchange');
  }
  if (alloc.some((x) => x.owner === NEUTRAL)) kinds.add('neutral');
  if (alloc.some((x) => x.owner === SHARED)) kinds.add('shared');

  const evaluate = (me: Polity, them: Polity, mine: 'va' | 'vb', sMine: 'sa' | 'sb', sTheirs: 'sa' | 'sb') => {
    const ch = state.config.clouds.characters[state.clouds[me.cloud].character];
    const total = alloc.reduce((s, x) => s + x[mine], 0) + 1e-9;
    let deal = 0;
    for (const x of alloc) {
      if (x.owner === me.id) deal += x[mine];
      else if (x.owner === SHARED) deal += 0.6 * x[mine];
      else if (x.owner === NEUTRAL) deal += 0.25 * x[mine];
      else deal -= x[mine] * (x[sMine] / (x[sMine] + x[sTheirs] + 1e-9));
    }
    const myS = cloudStrength(state, me.cloud, index);
    const theirS = cloudStrength(state, them.cloud, index);
    const pWin = myS / (myS + theirS + 1e-9);
    // Past fighting between the two peoples makes another war look costlier.
    const memory = Math.min(1, (rel?.warTurns ?? 0) / 40);
    const war = (0.6 + ch.weights.conquest) * (pWin * total) - cfg.warCostWeight * ch.riskAversion * (0.6 + memory) * total - Math.max(0, attitude) / 100 * 0.5 * total;
    const statusQuo = -0.1 * total * (1 + neg!.rounds * 0.3);
    const compromise = ((ch.weights.trade + ch.weights.integrate) * 0.25 + attitude / 300) * total;
    const reasons: Reason[] = [
      { label: 'Ценность сделки', value: deal / total },
      { label: 'Сохранение спора', value: statusQuo / total },
      { label: 'Ожидаемый итог войны', value: war / total },
      { label: 'Выгода компромисса', value: compromise / total },
      { label: 'Вероятность победы', value: pWin },
      { label: 'Отношения', value: attitude / 100 },
      { label: 'Память о прошлых войнах', value: -memory },
    ];
    return { accept: deal + compromise >= Math.max(statusQuo, war), war: war > statusQuo && war > deal + compromise, reasons };
  };
  let ea = evaluate(A, B, 'va', 'sa', 'sb');
  let eb = evaluate(B, A, 'vb', 'sb', 'sa');
  // Concessions: while one side refuses and the other still has room to give,
  // hand over the cell that helps the refusing side most per unit of loss.
  for (let k = 0; k < alloc.length && ea.accept !== eb.accept; k++) {
    const giver = ea.accept ? A : B;
    const taker = ea.accept ? B : A;
    const [vg, vt] = giver === A ? (['va', 'vb'] as const) : (['vb', 'va'] as const);
    const cand = alloc
      .filter((x) => x.owner === giver.id)
      .sort((x, y) => y[vt] / (y[vg] + 1e-6) - x[vt] / (x[vg] + 1e-6) || x.idx - y.idx)[0];
    if (!cand) break;
    const prevOwner = cand.owner;
    // Try handing the cell over; if the giver cannot afford that, try shared use, then a neutral strip.
    let agreed = false;
    for (const owner of [taker.id, SHARED, NEUTRAL]) {
      if (owner === SHARED && attitude < -20) continue;
      cand.owner = owner;
      const na = evaluate(A, B, 'va', 'sa', 'sb');
      const nb = evaluate(B, A, 'vb', 'sb', 'sa');
      if (giver === A ? na.accept : nb.accept) {
        ea = na;
        eb = nb;
        kinds.add(owner === SHARED ? 'shared' : owner === NEUTRAL ? 'neutral' : 'exchange');
        agreed = true;
        break;
      }
    }
    if (!agreed) {
      cand.owner = prevOwner; // the giver would no longer agree: stop here
      break;
    }
  }
  logDecision(state, ca.id, 'negotiation', `Переговоры «${A.name}» — «${B.name}», раунд ${neg.rounds}: ${ea.accept ? 'согласие' : 'отказ'}`, ea.reasons, { target: cb.id, accepted: ea.accept });
  logDecision(state, cb.id, 'negotiation', `Переговоры «${B.name}» — «${A.name}», раунд ${neg.rounds}: ${eb.accept ? 'согласие' : 'отказ'}`, eb.reasons, { target: ca.id, accepted: eb.accept });

  if (ea.accept && eb.accept) {
    // New overlaps along an already agreed border extend that treaty instead of making a new one.
    const existing = state.treaties.find((t) => t.alive && ((t.a === A.id && t.b === B.id) || (t.a === B.id && t.b === A.id)));
    const supplement = !!existing;
    if (existing) {
      for (const x of alloc) {
        existing.cells = existing.cells.filter((c) => c.idx !== x.idx);
        existing.cells.push({ idx: x.idx, owner: x.owner });
        existing.baseline = existing.baseline.filter((c) => c.idx !== x.idx);
        existing.baseline.push(existing.a === A.id ? { idx: x.idx, sa: x.sa, sb: x.sb } : { idx: x.idx, sa: x.sb, sb: x.sa });
      }
      existing.kinds = [...new Set([...existing.kinds, ...kinds])];
    } else {
      const treaty: Treaty = {
        id: state.treaties.length,
        a: A.id,
        b: B.id,
        turn: state.turn,
        kinds: [...kinds],
        cells: alloc.map((x) => ({ idx: x.idx, owner: x.owner })),
        baseline: alloc.map((x) => ({ idx: x.idx, sa: x.sa, sb: x.sb })),
        alive: true,
        endedTurn: -1,
        endReason: '',
      };
      state.treaties.push(treaty);
      state.counters.treaties++;
    }
    neg.open = false;
    // A successful round sets no cooldown: new overlaps can be settled at once.
    neg.lastRoundTurn = -999;
    const p = state.politics;
    for (const x of alloc) {
      p.recognized[x.idx] = x.owner;
      p.control[x.idx] = x.owner >= 0 ? x.owner : -1;
      p.sharedBy[x.idx] = x.owner === SHARED ? [A.id, B.id] : null;
      p.disputed[x.idx] = false;
    }
    const kindText = [...kinds].map((k) => KIND_TEXT[k]).join(', ');
    logEvent(state, 'treaty', [ca.id, cb.id], `Сделка выгоднее спора и войны для обеих сторон (раунд ${neg.rounds})`,
      supplement
        ? `«${A.name}» и «${B.name}» уточнили границу: ${kindText} (+${alloc.length} гекс. около ${cellLabel(state, cells[0])})`
        : `«${A.name}» и «${B.name}» согласовали границу: ${kindText} (${alloc.length} гекс., около ${cellLabel(state, cells[0])})`, cells[0]);
    return;
  }
  const warSide = ea.war && !ea.accept ? A : eb.war && !eb.accept ? B : null;
  if (warSide && rel && rel.status !== 'alliance') {
    const aggressor = warSide.cloud;
    declareWar(state, rel, aggressor, `Территориальный спор (${cells.length} гекс.)`);
    neg.open = false;
  }
}

const KIND_TEXT: Record<TreatyKind, string> = {
  border: 'признанная граница',
  exchange: 'территориальный обмен',
  neutral: 'нейтральная полоса',
  shared: 'совместное использование',
};
