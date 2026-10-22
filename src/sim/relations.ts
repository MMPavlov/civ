import type { Relation, RelationStatus, SimState } from './types';

/**
 * Pairwise relations between clouds. Stored as an array in the state; the
 * lookup index is rebuilt lazily and never serialized.
 */
const indexCache = new WeakMap<Relation[], { size: number; map: Map<number, number> }>();

function key(a: number, b: number): number {
  return a < b ? a * 100000 + b : b * 100000 + a;
}

function lookup(state: SimState): Map<number, number> {
  let entry = indexCache.get(state.relations);
  if (!entry || entry.size !== state.relations.length) {
    const map = new Map<number, number>();
    state.relations.forEach((r, i) => map.set(key(r.a, r.b), i));
    entry = { size: state.relations.length, map };
    indexCache.set(state.relations, entry);
  }
  return entry.map;
}

export function getRelation(state: SimState, a: number, b: number): Relation | undefined {
  if (a === b) return undefined;
  const i = lookup(state).get(key(a, b));
  return i === undefined ? undefined : state.relations[i];
}

export function ensureRelation(state: SimState, a: number, b: number, attitude: number): Relation {
  const existing = getRelation(state, a, b);
  if (existing) return existing;
  const rel: Relation = {
    a: Math.min(a, b),
    b: Math.max(a, b),
    contactTurn: state.turn,
    attitude,
    status: 'contact',
    statusSince: state.turn,
    patron: -1,
    tradeTurns: 0,
    sharedTurns: 0,
    warTurns: 0,
    lastProposalTurn: -999,
    lastPeaceTurn: -999,
    integration: null,
    war: null,
  };
  state.relations.push(rel);
  return rel;
}

export function setStatus(state: SimState, rel: Relation, status: RelationStatus): void {
  if (rel.status !== status) {
    rel.status = status;
    rel.statusSince = state.turn;
  }
  if (status !== 'patronage') rel.patron = -1;
  if (status !== 'war') rel.war = null;
}

export function other(rel: Relation, id: number): number {
  return rel.a === id ? rel.b : rel.a;
}

export function relationsOf(state: SimState, id: number): Relation[] {
  return state.relations.filter((r) => (r.a === id || r.b === id) && state.clouds[r.a].alive && state.clouds[r.b].alive);
}

export function atWar(state: SimState, a: number, b: number): boolean {
  return getRelation(state, a, b)?.status === 'war';
}

/** Food/trade flow factor between two clouds (0 = no exchange). */
export function flowFactor(state: SimState, a: number, b: number): number {
  const f = state.config.food.flow;
  if (a === b) return f.same;
  const rel = getRelation(state, a, b);
  if (!rel) return 0;
  switch (rel.status) {
    case 'war':
      return f.war;
    case 'alliance':
      return f.ally;
    case 'trade':
      return f.trade;
    case 'patronage':
      return f.patron;
    default:
      return f.neutral;
  }
}
