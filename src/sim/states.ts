import { makeName } from './culture';
import { cellLabel, logDecision, logEvent } from './log';
import { clamp } from './noise';
import { cellUrban, type CloudIndex } from './pop';
import type { Cloud, Polity, Reason, Settlement, SimState } from './types';

const LEVEL_INSTITUTIONS = [0.15, 1, 2.5];

/**
 * State formation (turn stage 12). Institutions grow with towns and cities
 * and decay without them:
 *     I += g · min(3, Σ_s levelWeight_s) · (0.5 + cohesion) − δ · I
 * A medium or large cloud forms a polity only when, for formationTurns
 * consecutive turns, it has a town/city as political centre, enough
 * population, institutions, a food surplus and minimum cohesion. Having a
 * city alone is not enough. A polity without a qualifying capital tries to
 * move its capital and collapses after collapseTurns of crisis.
 */
export function runStates(state: SimState, index: CloudIndex): void {
  const cfg = state.config.states;
  const byCloud = new Map<number, Settlement[]>();
  for (const s of state.settlements) {
    if (!s.alive) continue;
    const list = byCloud.get(s.cloud) ?? [];
    list.push(s);
    byCloud.set(s.cloud, list);
  }
  for (const cloud of state.clouds) {
    if (!cloud.alive) continue;
    const classDef = state.config.clouds.classes[cloud.cls];
    const own = byCloud.get(cloud.id) ?? [];
    const settleScore = own.reduce((sum, s) => sum + LEVEL_INSTITUTIONS[s.level - 1], 0);
    cloud.institutions = clamp(
      cloud.institutions + cfg.institutionsGrowth * Math.min(3, settleScore) * (0.5 + cloud.cohesion) - cfg.institutionsDecay * cloud.institutions,
      0,
      1,
    );
    if (!classDef.canFormState) continue;

    if (cloud.polity < 0) {
      const capital = bestCapital(state, own);
      const surplus = cloudSurplus(state, cloud, index);
      const reasons: Reason[] = [
        { label: 'Население', value: index.pop[cloud.id] },
        { label: 'Политический центр (уровень)', value: capital ? capital.level : 0 },
        { label: 'Институты', value: cloud.institutions },
        { label: 'Продовольственный избыток', value: surplus },
        { label: 'Сплочённость', value: cloud.cohesion },
      ];
      const ok =
        index.pop[cloud.id] >= cfg.minPopulation &&
        capital !== null &&
        cloud.institutions >= cfg.minInstitutions &&
        surplus >= cfg.minSurplus &&
        cloud.cohesion >= 0.35;
      cloud.stateReasons = reasons;
      cloud.stateStreak = ok ? cloud.stateStreak + 1 : 0;
      if (ok && cloud.stateStreak >= cfg.formationTurns && capital) formPolity(state, cloud, capital, reasons);
    } else {
      const pol = state.polities[cloud.polity];
      const cap = state.settlements[pol.capital];
      const valid = cap && cap.alive && cap.cloud === cloud.id && cap.level >= cfg.minCapitalLevel;
      if (valid) pol.crisis = Math.max(0, pol.crisis - 1);
      else {
        const alt = bestCapital(state, own);
        if (alt) {
          pol.capital = alt.id;
          pol.crisis = 0;
          logEvent(state, 'state', [cloud.id], 'Прежний центр утратил значение', `${pol.name} перенесло столицу в ${alt.name} ${cellLabel(state, alt.hex)}`, alt.hex);
        } else pol.crisis++;
      }
      if (pol.crisis >= cfg.collapseTurns) collapsePolity(state, pol, 'Утрата политического центра');
    }
  }
  for (const pol of state.polities) {
    if (pol.alive && !state.clouds[pol.cloud].alive) collapsePolity(state, pol, 'Исчезновение облака-основателя');
  }
}

function bestCapital(state: SimState, own: Settlement[]): Settlement | null {
  let best: Settlement | null = null;
  let bestScore = -1;
  for (const s of own) {
    if (s.level < state.config.states.minCapitalLevel) continue;
    const score = s.level * 1000 + cellUrban(state.cells[s.hex]);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function cloudSurplus(state: SimState, cloud: Cloud, index: CloudIndex): number {
  let s = 0;
  index.cells[cloud.id].forEach((idx, j) => {
    const cell = state.cells[idx];
    let all = 0;
    for (const g of cell.groups) all += g.rural + g.urban;
    if (all > 0) s += cell.food.surplus * (index.cellPop[cloud.id][j] / all);
  });
  return s;
}

function formPolity(state: SimState, cloud: Cloud, capital: Settlement, reasons: Reason[]): void {
  const pol: Polity = {
    id: state.polities.length,
    name: `${makeName(state.rng)}ское государство`.replace(/^(.)/, (m) => m.toUpperCase()),
    cloud: cloud.id,
    capital: capital.id,
    foundedTurn: state.turn,
    alive: true,
    endedTurn: -1,
    hue: cloud.hue,
    crisis: 0,
  };
  state.polities.push(pol);
  cloud.polity = pol.id;
  cloud.stateStreak = 0;
  state.counters.statesFormed++;
  logDecision(state, cloud.id, 'state', `${cloud.name} образовал государство «${pol.name}»`, reasons, { hex: capital.hex });
  logEvent(state, 'state', [cloud.id], `Столица ${capital.name}, институты ${cloud.institutions.toFixed(2)}, ${state.config.states.formationTurns} ходов устойчивых условий`,
    `Образовано государство «${pol.name}» (${cloud.name})`, capital.hex);
}

export function collapsePolity(state: SimState, pol: Polity, why: string): void {
  if (!pol.alive) return;
  pol.alive = false;
  pol.endedTurn = state.turn;
  const cloud = state.clouds[pol.cloud];
  if (cloud.polity === pol.id) cloud.polity = -1;
  const p = state.politics;
  for (let i = 0; i < p.claims.length; i++) {
    p.claims[i] = p.claims[i].filter((c) => c.p !== pol.id);
    if (p.control[i] === pol.id) p.control[i] = -1;
    if (p.recognized[i] === pol.id) p.recognized[i] = -1;
  }
  for (const t of state.treaties) {
    if (t.alive && (t.a === pol.id || t.b === pol.id)) {
      t.alive = false;
      t.endedTurn = state.turn;
      t.endReason = `Распад ${pol.name}`;
    }
  }
  for (const n of state.negotiations) if (n.a === pol.id || n.b === pol.id) n.open = false;
  logEvent(state, 'state_collapse', [pol.cloud], why, `Государство «${pol.name}» распалось`);
}
