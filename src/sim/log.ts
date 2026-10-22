import type { Decision, DecisionKind, EventType, Reason, SimEvent, SimState } from './types';

export function logEvent(
  state: SimState,
  type: EventType,
  actors: number[],
  cause: string,
  result: string,
  hex = -1,
): SimEvent {
  const ev: SimEvent = { turn: state.turn, type, actors, hex, cause, result };
  state.events.push(ev);
  const max = state.config.sim.maxEvents;
  if (state.events.length > max) state.events.splice(0, state.events.length - max);
  return ev;
}

export function logDecision(
  state: SimState,
  cloud: number,
  kind: DecisionKind,
  title: string,
  reasons: Reason[],
  opts: { hex?: number; target?: number; accepted?: boolean } = {},
): void {
  const d: Decision = {
    turn: state.turn,
    cloud,
    kind,
    title,
    hex: opts.hex ?? -1,
    target: opts.target ?? -1,
    accepted: opts.accepted ?? true,
    reasons: reasons
      .filter((r) => Number.isFinite(r.value))
      .map((r) => ({ label: r.label, value: Math.round(r.value * 1000) / 1000 })),
  };
  state.decisions.push(d);
  const max = state.config.sim.maxDecisions;
  if (state.decisions.length > max) state.decisions.splice(0, state.decisions.length - max);
}

/** Reasons sorted by absolute contribution, strongest first. */
export function topReasons(reasons: Reason[], n = 5): Reason[] {
  return [...reasons].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, n);
}

export function cellLabel(state: SimState, idx: number): string {
  const h = state.map.hexes[idx];
  return `(${h.col}, ${h.row})`;
}

export function cloudName(state: SimState, id: number): string {
  return state.clouds[id]?.name ?? `#${id}`;
}
