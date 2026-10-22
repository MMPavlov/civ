import { contestedLand, KIND_NAMES, securityNeed, type Knowledge, type Proposal } from './ai';
import { distanceById } from './culture';
import { getGeo } from './geo';
import { cloudName, logDecision, logEvent } from './log';
import { clamp } from './noise';
import { addPop, compactCell, type CloudIndex } from './pop';
import { ensureRelation, getRelation, other, relationsOf, setStatus } from './relations';
import { normal, shuffle } from './rng';
import type { CharacterId, Cloud, InternalGroup, Reason, Relation, SimState } from './types';

const CHARACTER_BIAS: Record<CharacterId, number> = {
  trader: 8,
  integrator: 5,
  expansionist: 0,
  isolationist: -6,
  conqueror: -10,
};

/** Long-run attitude two peoples drift towards, from culture and characters. */
export function baselineAttitude(state: SimState, a: number, b: number): number {
  const ca = state.clouds[a];
  const cb = state.clouds[b];
  const d = distanceById(state, ca.culture, cb.culture);
  const iso = ((ca.isolation + cb.isolation) / 200) * 10;
  return 22 - state.config.interactions.attitudeDistancePenalty * d + (CHARACTER_BIAS[ca.character] + CHARACTER_BIAS[cb.character]) / 2 - iso;
}

/**
 * Contacts (turn stage 7a): two clouds meet when their populations share a
 * cell or sit on adjacent cells. Then attitudes drift towards the baseline,
 * pushed by trade, alliances, war and friction over crowded shared land.
 */
export function updateContacts(state: SimState, index: CloudIndex): void {
  const geo = getGeo(state);
  const icfg = state.config.interactions;
  const inContact = new Map<string, number>();
  const touch = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    inContact.set(key, (inContact.get(key) ?? 0) + 1);
  };
  for (let idx = 0; idx < state.cells.length; idx++) {
    const groups = state.cells[idx].groups;
    if (!groups.length) continue;
    const here = [...new Set(groups.map((g) => g.cloud))];
    for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) touch(here[i], here[j]);
    if (icfg.contactRadius >= 1) {
      for (const n of geo.neighbors[idx]) {
        if (n < idx) continue;
        for (const g of state.cells[n].groups) for (const h of here) touch(h, g.cloud);
      }
    }
  }
  for (const key of [...inContact.keys()].sort()) {
    const [a, b] = key.split(':').map(Number);
    if (!state.clouds[a].alive || !state.clouds[b].alive) continue;
    let rel = getRelation(state, a, b);
    if (!rel) {
      rel = ensureRelation(state, a, b, baselineAttitude(state, a, b) * 0.5);
      const d = distanceById(state, state.clouds[a].culture, state.clouds[b].culture);
      logEvent(state, 'contact', [a, b], 'Ареалы расселения соприкоснулись',
        `${cloudName(state, a)} и ${cloudName(state, b)} вступили в контакт (культурная дистанция ${d.toFixed(2)})`);
    }
    rel.sharedTurns++;
    if (rel.status === 'contact' && state.turn - rel.statusSince >= 5) setStatus(state, rel, 'coexist');
  }

  for (const rel of state.relations) {
    if (!state.clouds[rel.a].alive || !state.clouds[rel.b].alive) continue;
    const base = baselineAttitude(state, rel.a, rel.b);
    let att = rel.attitude + icfg.attitudeDrift * (base - rel.attitude);
    if (rel.status === 'trade') {
      att += icfg.tradeBonus;
      rel.tradeTurns++;
    }
    if (rel.status === 'alliance') {
      att += icfg.allianceBonus;
      rel.tradeTurns++;
    }
    if (rel.status === 'patronage') att += 0.8;
    if (rel.status === 'war') {
      att -= icfg.warPenalty;
      rel.warTurns++;
    }
    att -= icfg.frictionPenalty * contestedLand(state, rel.a, rel.b, index);
    rel.attitude = clamp(att, -100, 100);

    // Relations decay when attitudes no longer support them.
    if (rel.status === 'alliance' && rel.attitude < icfg.allianceMinAttitude - 25) setStatus(state, rel, 'trade');
    if (rel.status === 'trade' && rel.attitude < icfg.tradeMinAttitude - 25) setStatus(state, rel, 'coexist');
    if (rel.status === 'patronage' && rel.attitude < 0) setStatus(state, rel, 'coexist');
  }
}

/**
 * Resolve the proposals of all clouds together (turn stage 7b). Each target
 * accepts at most one major proposal per turn; competing proposals are
 * ranked by utility with random tie-breaks drawn at proposal time, so array
 * order gives no advantage.
 */
export function resolveProposals(state: SimState, proposals: Proposal[], index: CloudIndex, k: Knowledge): void {
  const icfg = state.config.interactions;
  const busy = new Set<number>();
  const ordered = shuffle(state.rng, [...proposals]).sort((a, b) => b.utility - a.utility || a.tiebreak - b.tiebreak);
  for (const p of ordered) {
    const actor = state.clouds[p.actor];
    const target = state.clouds[p.target];
    if (!actor.alive || !target.alive) continue;
    if (busy.has(p.actor) || busy.has(p.target)) continue;
    const rel = getRelation(state, p.actor, p.target);
    if (!rel) continue;
    rel.lastProposalTurn = state.turn;
    actor.lastMajorTurn = state.turn;
    const { accept, reasons } = evaluateAcceptance(state, p, rel, index, k);
    const noise = normal(state.rng, 0, icfg.acceptanceNoise);
    const accepted = p.kind === 'war' || accept + noise > 0;
    const title = `${actor.name} → ${target.name}: ${KIND_NAMES[p.kind]}`;
    logDecision(state, p.actor, p.kind === 'war' ? 'war' : p.kind === 'integration' ? 'integration' : 'diplomacy',
      `${title} — ${accepted ? 'принято' : 'отклонено'}`, [...p.reasons, ...reasons.map((r) => ({ label: `${target.name}: ${r.label.toLowerCase()}`, value: r.value }))], { target: p.target, accepted });
    if (!accepted) {
      if (p.kind === 'integration') {
        logEvent(state, 'integration_refused', [p.target, p.actor], reasons.map((r) => r.label).slice(0, 3).join(', '),
          `${target.name} отказался войти в состав ${actor.name}`);
      }
      continue;
    }
    busy.add(p.actor);
    busy.add(p.target);
    applyProposal(state, p, rel);
  }
}

function evaluateAcceptance(state: SimState, p: Proposal, rel: Relation, index: CloudIndex, k: Knowledge): { accept: number; reasons: Reason[] } {
  const target = state.clouds[p.target];
  const actor = state.clouds[p.actor];
  const ch = state.config.clouds.characters[target.character];
  const w = ch.weights;
  const att = rel.attitude / 100;
  const iso = target.isolation / 100;
  switch (p.kind) {
    case 'trade': {
      const r: Reason[] = [
        { label: 'Отношение', value: att },
        { label: 'Вес торговли у адресата', value: w.trade },
        { label: 'Обособленность адресата', value: -iso * 0.3 },
      ];
      return { accept: 0.25 * w.trade + 0.5 * att + 0.1 - 0.3 * iso * w.autonomy, reasons: r };
    }
    case 'alliance': {
      const sec = securityNeed(state, p.target, index, k);
      return {
        accept: att - 0.35 + 0.4 * sec - 0.25 * w.autonomy,
        reasons: [{ label: 'Отношение', value: att }, { label: 'Потребность в защите', value: sec }],
      };
    }
    case 'patronage': {
      const sec = securityNeed(state, p.target, index, k);
      return {
        accept: 0.6 * sec + 0.6 * att - 0.5 * iso + 0.05,
        reasons: [
          { label: 'Потребность в защите', value: sec },
          { label: 'Отношение', value: att },
          { label: 'Обособленность', value: -iso },
        ],
      };
    }
    case 'integration': {
      const sec = securityNeed(state, p.target, index, k);
      const dist = distanceById(state, actor.culture, target.culture);
      const patron = rel.status === 'patronage' && rel.patron === p.actor ? 0.2 : 0;
      let fam = 0;
      let n = 0;
      index.cells[p.target].forEach((idx, j) => {
        fam += (1 - state.cells[idx].food.ratio) * index.cellPop[p.target][j];
        n += index.cellPop[p.target][j];
      });
      const hunger = n > 0 ? fam / n : 0;
      const reasons: Reason[] = [
        { label: 'Готовность (1 − обособленность)', value: 1 - iso },
        { label: 'Отношение', value: att },
        { label: 'Покровительство', value: patron },
        { label: 'Потребность в защите', value: sec },
        { label: 'Нехватка пищи', value: hunger },
        { label: 'Культурная дистанция', value: -dist },
        { label: 'Самостоятельность среднего облака', value: target.cls === 'medium' ? -0.25 : 0 },
      ];
      const accept = (1 - iso) * (0.4 + att) + patron + 0.25 * sec + 0.3 * hunger - 0.55 * dist - (target.cls === 'medium' ? 0.25 : 0) - 0.2 - 0.2 * w.autonomy;
      return { accept, reasons };
    }
    case 'peace': {
      const wear = rel.war?.weariness ?? 0;
      return { accept: wear - 0.4 + 0.3 * w.trade - 0.3 * w.conquest, reasons: [{ label: 'Усталость от войны', value: wear }] };
    }
    case 'war':
      return { accept: 1, reasons: [] };
  }
}

function applyProposal(state: SimState, p: Proposal, rel: Relation): void {
  const a = cloudName(state, p.actor);
  const b = cloudName(state, p.target);
  switch (p.kind) {
    case 'trade':
      setStatus(state, rel, 'trade');
      logEvent(state, 'trade', [p.actor, p.target], 'Взаимная выгода обмена', `${a} и ${b} установили торговые связи`);
      break;
    case 'alliance':
      setStatus(state, rel, 'alliance');
      logEvent(state, 'alliance', [p.actor, p.target], 'Долгое сотрудничество и общие интересы', `${a} и ${b} заключили союз`);
      break;
    case 'patronage':
      setStatus(state, rel, 'patronage');
      rel.patron = p.actor;
      logEvent(state, 'patronage', [p.actor, p.target], 'Потребность малого народа в защите', `${a} взял под покровительство ${b}`);
      break;
    case 'integration': {
      const dist = distanceById(state, state.clouds[p.actor].culture, state.clouds[p.target].culture);
      rel.integration = { actor: p.actor, target: p.target, progress: 0, startTurn: state.turn, distance: dist };
      logEvent(state, 'integration_start', [p.actor, p.target], `Согласие ${b}; культурная дистанция ${dist.toFixed(2)}`,
        `${b} начал входить в состав ${a}`);
      break;
    }
    case 'war':
      declareWar(state, rel, p.actor, p.reasons.map((r) => r.label).slice(0, 2).join(', '));
      break;
    case 'peace':
      endWar(state, rel, `${a} и ${b} заключили мир`);
      break;
  }
}

export function declareWar(state: SimState, rel: Relation, aggressor: number, reason: string): void {
  setStatus(state, rel, 'war');
  rel.attitude = Math.min(rel.attitude, 0) - 15;
  rel.war = { aggressor, startTurn: state.turn, weariness: 0, lossesA: 0, lossesB: 0, reason };
  rel.integration = null;
  rel.lastProposalTurn = state.turn;
  state.counters.wars++;
  const defender = rel.a === aggressor ? rel.b : rel.a;
  logEvent(state, 'conflict', [aggressor, defender], reason, `${cloudName(state, aggressor)} начал конфликт с ${cloudName(state, defender)}`);
  // A war voids border treaties between the two peoples' states.
  const pa = state.clouds[aggressor].polity;
  const pd = state.clouds[defender].polity;
  if (pa >= 0 && pd >= 0) {
    for (const t of state.treaties) {
      if (t.alive && ((t.a === pa && t.b === pd) || (t.a === pd && t.b === pa))) {
        t.alive = false;
        t.endedTurn = state.turn;
        t.endReason = 'Война';
        logEvent(state, 'treaty_broken', [aggressor, defender], 'Начало войны', 'Договор о границе расторгнут');
      }
    }
  }
}

export function endWar(state: SimState, rel: Relation, text: string): void {
  const losses = rel.war ? Math.round(rel.war.lossesA + rel.war.lossesB) : 0;
  setStatus(state, rel, 'coexist');
  rel.attitude = Math.min(100, rel.attitude + 10);
  rel.lastProposalTurn = state.turn;
  rel.lastPeaceTurn = state.turn;
  logEvent(state, 'peace', [rel.a, rel.b], `Истощение сторон (потери ≈ ${losses})`, text);
}

/** Integration processes advance each turn; duration grows with cultural distance. */
export function progressIntegrations(state: SimState): void {
  const icfg = state.config.interactions;
  for (const rel of state.relations) {
    const it = rel.integration;
    if (!it) continue;
    const actor = state.clouds[it.actor];
    const target = state.clouds[it.target];
    if (!actor.alive || !target.alive) {
      rel.integration = null;
      continue;
    }
    if (rel.status === 'war' || rel.attitude < icfg.integrationMinAttitude - 15) {
      rel.integration = null;
      logEvent(state, 'integration_refused', [it.target, it.actor], 'Отношения ухудшились', `Интеграция ${target.name} в ${actor.name} прервана`);
      continue;
    }
    it.progress += 1 / (icfg.integrationBaseTurns + icfg.integrationDistanceTurns * it.distance);
    if (it.progress >= 1) {
      rel.integration = null;
      integrateClouds(state, it.actor, it.target);
    }
  }
}

/**
 * The target's population joins the actor: every group keeps its race and
 * culture and only changes its cloud membership. No population is created
 * or removed (checked by the invariant tests).
 */
export function integrateClouds(state: SimState, actorId: number, targetId: number): void {
  const actor = state.clouds[actorId];
  const target = state.clouds[targetId];
  if (!actor.alive || !target.alive || actorId === targetId) return;
  if (target.cls === 'large') throw new Error('Large clouds cannot be absorbed');
  let moved = 0;
  for (const cell of state.cells) {
    let touched = false;
    for (const g of cell.groups) {
      if (g.cloud === targetId) {
        g.cloud = actorId;
        moved += g.rural + g.urban;
        touched = true;
      }
    }
    if (touched) compactCell(cell);
  }
  for (const tg of target.groups) {
    const existing = actor.groups.find((g) => g.culture === tg.culture && g.race === tg.race);
    if (existing) {
      existing.isolation = (existing.isolation + tg.isolation) / 2;
      continue;
    }
    const group: InternalGroup = {
      culture: tg.culture,
      race: tg.race,
      isolation: Math.max(0, (tg.culture === target.culture ? target.isolation : tg.isolation) * 0.85),
      joinedTurn: state.turn,
      origin: tg.origin === target.name ? target.name : `${tg.origin} (через ${target.name})`,
      originCloud: tg.originCloud,
      hybridProgress: 0,
      cohesion: 0.55,
      schismRisk: 0,
    };
    actor.groups.push(group);
  }
  const dist = distanceById(state, actor.culture, target.culture);
  actor.cohesion = clamp(actor.cohesion - state.config.interactions.integrationCohesionCost * (0.5 + dist), 0, 1);
  target.alive = false;
  target.absorbedInto = actorId;
  target.diedTurn = state.turn;
  for (const s of state.settlements) if (s.alive && s.cloud === targetId) s.cloud = actorId;
  if (target.polity >= 0) {
    const pol = state.polities[target.polity];
    if (actor.polity < 0) {
      actor.polity = pol.id;
      pol.cloud = actorId;
    } else {
      pol.alive = false;
      pol.endedTurn = state.turn;
    }
    target.polity = -1;
  }
  // Relations of the absorbed cloud carry over to the integrator where none exist.
  for (const rel of relationsOf(state, targetId)) {
    const o = other(rel, targetId);
    if (o === actorId) continue;
    if (!getRelation(state, actorId, o)) ensureRelation(state, actorId, o, rel.attitude * 0.5);
  }
  state.counters.integrations++;
  logEvent(state, 'integration', [actorId, targetId], `Культурная дистанция ${dist.toFixed(2)}, обособленность ${Math.round(target.isolation)}`,
    `${target.name} вошёл в состав ${actor.name} (≈${Math.round(moved)} чел.), сохранив свою культуру`);
}

/**
 * Conflicts (turn stage 8): fighting happens where the two peoples share
 * cells. Each side loses population in proportion to the other's local
 * strength; the weaker side is partly displaced to its own neighbouring
 * cells (people move, they do not vanish). The aggressor also pushes
 * settlers into adjacent enemy-held cells where it is locally stronger.
 */
export function runConflicts(state: SimState, index: CloudIndex): void {
  const icfg = state.config.interactions;
  const geo = getGeo(state);
  for (const rel of state.relations) {
    if (rel.status !== 'war' || !rel.war) continue;
    const A = state.clouds[rel.a];
    const B = state.clouds[rel.b];
    if (!A.alive || !B.alive) {
      setStatus(state, rel, 'coexist');
      continue;
    }
    const war = rel.war;
    const mod = (c: Cloud) => (0.6 + 0.4 * c.cohesion) * (1 + 0.5 * c.institutions);
    let lossA = 0;
    let lossB = 0;
    const bCells = new Set(index.cells[B.id]);
    const moves: Array<{ from: number; to: number; cloud: number; amount: number }> = [];
    for (const idx of index.cells[A.id]) {
      if (!bCells.has(idx)) continue;
      const cell = state.cells[idx];
      const pa = sumCloud(cell, A.id);
      const pb = sumCloud(cell, B.id);
      if (pa <= 0 || pb <= 0) continue;
      const def = state.map.hexes[idx].defense;
      const sa = pa * mod(A) * (pa >= pb ? 1 + def : 1);
      const sb = pb * mod(B) * (pb > pa ? 1 + def : 1);
      const la = Math.min(pa * 0.5, icfg.warLossRate * pa * (2 * sb / (sa + sb)));
      const lb = Math.min(pb * 0.5, icfg.warLossRate * pb * (2 * sa / (sa + sb)));
      scaleCloud(cell, A.id, (pa - la) / pa);
      scaleCloud(cell, B.id, (pb - lb) / pb);
      lossA += la;
      lossB += lb;
      // Displacement of the weaker side.
      const weak = sa < sb ? A.id : B.id;
      const pw = weak === A.id ? pa - la : pb - lb;
      const ratio = Math.abs(sa - sb) / (sa + sb);
      const displaced = icfg.warDisplacement * pw * ratio * 2;
      const enemy = weak === A.id ? B.id : A.id;
      const refuge = geo.neighbors[idx]
        .filter((n) => geo.habitable[n] && sumCloud(state.cells[n], enemy) <= 0)
        .sort((x, y) => sumCloud(state.cells[y], weak) - sumCloud(state.cells[x], weak) || x - y)[0];
      if (refuge !== undefined && displaced > 0.5) moves.push({ from: idx, to: refuge, cloud: weak, amount: displaced });
    }
    // Aggressor pushes into adjacent enemy-held cells where it is locally stronger.
    const agg = war.aggressor;
    const def = agg === A.id ? B.id : A.id;
    const aggStrong = perceivedStrengthLocal(state, agg, index) > perceivedStrengthLocal(state, def, index) * 0.9;
    if (aggStrong) {
      const defCells = new Set(index.cells[def]);
      for (const idx of index.cells[agg]) {
        const cell = state.cells[idx];
        const pa = sumCloud(cell, agg);
        if (pa < 20 || sumCloud(cell, def) > 0) continue;
        const targetCell = geo.neighbors[idx].find((n) => defCells.has(n) && geo.habitable[n] && Number.isFinite(state.map.hexes[n].moveCost));
        if (targetCell === undefined) continue;
        moves.push({ from: idx, to: targetCell, cloud: agg, amount: 0.04 * pa });
      }
    }
    for (const m of moves) {
      // Small clouds may not spread beyond their maximum area, even when displaced.
      if (!mayEnter(state, m.cloud, m.to)) continue;
      moveCloudPop(state, m.from, m.to, m.cloud, m.amount);
    }
    war.lossesA += lossA;
    war.lossesB += lossB;
    state.counters.warDeaths += lossA + lossB;
    const burden = (lossA + lossB) / (index.pop[A.id] + index.pop[B.id] + 1);
    war.weariness += icfg.warWearinessRate * (1 + burden * 40);
    if (war.weariness >= icfg.peaceWeariness * 1.6) endWar(state, rel, `${A.name} и ${B.name} прекратили войну от истощения`);
  }
}

function perceivedStrengthLocal(state: SimState, id: number, index: CloudIndex): number {
  const c = state.clouds[id];
  return index.pop[id] * (0.5 + c.cohesion) * (1 + c.institutions);
}

function sumCloud(cell: { groups: Array<{ cloud: number; rural: number; urban: number }> }, cloud: number): number {
  let s = 0;
  for (const g of cell.groups) if (g.cloud === cloud) s += g.rural + g.urban;
  return s;
}

function scaleCloud(cell: { groups: Array<{ cloud: number; rural: number; urban: number }> }, cloud: number, f: number): void {
  for (const g of cell.groups) {
    if (g.cloud !== cloud) continue;
    g.rural *= f;
    g.urban *= f;
  }
}

/** Whether a cloud may move people into a cell (area limit of small clouds). */
export function mayEnter(state: SimState, cloudId: number, cell: number): boolean {
  const cloud = state.clouds[cloudId];
  if (cloud.maxArea <= 0) return true;
  if (sumCloud(state.cells[cell], cloudId) > 0) return true;
  let area = 0;
  for (const c of state.cells) if (c.groups.some((g) => g.cloud === cloudId)) area++;
  return area < cloud.maxArea;
}

/** Move `amount` people of a cloud between cells, keeping each group's race/culture. */
export function moveCloudPop(state: SimState, from: number, to: number, cloud: number, amount: number): void {
  const src = state.cells[from];
  const total = sumCloud(src, cloud);
  if (total <= 0 || amount <= 0) return;
  const f = Math.min(1, amount / total);
  for (const g of [...src.groups]) {
    if (g.cloud !== cloud) continue;
    const take = (g.rural + g.urban) * f;
    const rTake = g.rural * f;
    g.rural -= rTake;
    g.urban -= take - rTake;
    addPop(state.cells[to], cloud, g.race, g.culture, take, 0);
  }
  compactCell(src);
  compactCell(state.cells[to]);
}

/**
 * Isolation of independent small/medium clouds drifts with experience:
 * friendly relations lower it, wars and hostility raise it.
 */
export function updateIsolation(state: SimState): void {
  const rate = state.config.culture.isolationDrift;
  for (const c of state.clouds) {
    if (!c.alive || c.cls === 'large') continue;
    const rels = relationsOf(state, c.id);
    if (!rels.length) continue;
    let att = 0;
    let wars = 0;
    for (const r of rels) {
      att += r.attitude;
      if (r.status === 'war') wars++;
    }
    att /= rels.length;
    const delta = rate * (-(att / 50) + wars * 2);
    c.isolation = clamp(c.isolation + delta, 0, 100);
    const core = c.groups.find((g) => g.culture === c.culture);
    if (core) core.isolation = c.isolation;
  }
}

