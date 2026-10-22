import { getGeo } from './geo';
import { logEvent } from './log';
import type { SimState } from './types';

/**
 * End-of-run detection. The political map counts as stable when, for
 * stabilityWindow consecutive turns:
 *   - there are at least two states and at least one pair of them is in
 *     contact (their claims touch or overlap) — otherwise there is no border
 *     to stabilise yet;
 *   - no cell is disputed: every overlap is covered by a treaty (border,
 *     exchange, neutral strip or shared use);
 *   - no significant territorial war (state vs state, or a state vs a
 *     medium/large people), no open negotiation, and no cloud currently
 *     meeting all the conditions of statehood;
 *   - the claimed area of every state stays within max(3 cells, 6 %) of its
 *     size at the start of the window (territories have stopped expanding), and world
 *     population within 10 % (the land has filled up).
 */
export function checkStability(state: SimState): void {
  const st = state.stability;
  const polities = state.polities.filter((p) => p.alive);
  const claims = state.politics.claims;
  const area = polities.map((p) => claims.reduce((n, c) => n + (c.some((x) => x.p === p.id) ? 1 : 0), 0));

  const disputes = state.politics.disputed.some((d) => d);
  // Significant territorial wars: between two states, or a state against a medium/large people.
  const significant = (a: number, b: number) => {
    const ca = state.clouds[a];
    const cb = state.clouds[b];
    if (!ca.alive || !cb.alive) return false;
    if (ca.polity >= 0 && cb.polity >= 0) return true;
    return (ca.polity >= 0 && cb.cls !== 'small') || (cb.polity >= 0 && ca.cls !== 'small');
  };
  const wars = state.relations.some((r) => r.status === 'war' && significant(r.a, r.b));
  const openTalks = state.negotiations.some((n) => n.open);
  const contact = statesInContact(state);
  let steady = st.signature.length === area.length && st.stableTurns > 0;
  if (steady) {
    for (let i = 0; i < area.length; i++) {
      if (Math.abs(area[i] - st.signature[i]) > Math.max(3, 0.06 * st.signature[i])) steady = false;
    }
  }
  // A cloud that meets all conditions of statehood right now would still change the map.
  const forming = state.clouds.some((c) => c.alive && c.polity < 0 && c.stateStreak > 0);
  let pop = 0;
  for (const cell of state.cells) for (const g of cell.groups) pop += g.rural + g.urban;
  const okNow = polities.length >= 2 && contact && !disputes && !wars && !openTalks && !forming;
  // The world must have filled up: population within 10 % of its value at the window start.
  if (steady && Math.abs(pop - st.popAtStart) > 0.1 * st.popAtStart) steady = false;
  if (!okNow) {
    st.stableTurns = 0;
  } else if (!steady) {
    st.stableTurns = 1;
    st.signature = area;
    st.popAtStart = pop;
  } else {
    st.stableTurns++;
  }
  if (st.stableTurns >= state.config.sim.stabilityWindow && !st.finished) {
    st.finished = true;
    st.stabilizedTurn = state.turn;
    st.reason = `Политическая карта стабильна ${st.stableTurns} ходов`;
    logEvent(state, 'stabilized', polities.map((p) => p.cloud), 'Нет споров, войн и открытых переговоров; территории перестали расти', st.reason);
  } else if (state.turn >= state.config.sim.maxTurns && !st.finished) {
    st.finished = true;
    st.reason = `Достигнут лимит ходов (${state.config.sim.maxTurns}) без политической стабилизации`;
  }
}

/** True if the claims of two different states overlap or touch somewhere. */
export function statesInContact(state: SimState): boolean {
  const geo = getGeo(state);
  const claims = state.politics.claims;
  for (let i = 0; i < claims.length; i++) {
    const here = claims[i];
    if (!here.length) continue;
    if (here.length > 1) return true;
    for (const n of geo.neighbors[i]) {
      for (const c of claims[n]) if (c.p !== here[0].p) return true;
    }
  }
  return false;
}
