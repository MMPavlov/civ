import { indexClouds, type CloudIndex } from './pop';
import type { SimState, TurnStats } from './types';

export function recordStats(state: SimState, index: CloudIndex = indexClouds(state)): TurnStats {
  let totalPop = 0;
  let urbanPop = 0;
  for (const c of state.cells) {
    for (const g of c.groups) {
      totalPop += g.rural + g.urban;
      urbanPop += g.urban;
    }
  }
  const alive = state.settlements.filter((s) => s.alive);
  const p = state.politics;
  let claimed = 0;
  let delimited = 0;
  let disputes = 0;
  for (let i = 0; i < state.cells.length; i++) {
    if (p.claims[i].length) {
      claimed++;
      if (p.recognized[i] !== -1) delimited++;
      if (p.disputed[i]) disputes++;
    }
  }
  const sample: TurnStats = {
    turn: state.turn,
    totalPop,
    urbanPop,
    villages: alive.filter((s) => s.level === 1).length,
    towns: alive.filter((s) => s.level === 2).length,
    cities: alive.filter((s) => s.level === 3).length,
    states: state.polities.filter((x) => x.alive).length,
    disputes,
    delimitedShare: claimed ? delimited / claimed : 0,
    wars: state.relations.filter((r) => r.status === 'war').length,
    clouds: state.clouds
      .filter((c) => c.alive)
      .map((c) => ({
        id: c.id,
        pop: round1(index.pop[c.id]),
        area: index.cells[c.id].length,
        cohesion: round3(c.cohesion),
        load: round3(c.load),
        capacity: round3(c.capacity),
      })),
  };
  state.history.push(sample);
  return sample;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
