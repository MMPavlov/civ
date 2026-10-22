import { buildKnowledge, chooseStrategies, proposeActions } from './ai';
import { runBorders } from './borders';
import { runHybridization, updateCohesion } from './cohesion';
import { runDemography } from './demography';
import { runFood } from './food';
import { progressIntegrations, resolveProposals, runConflicts, updateContacts, updateIsolation } from './interactions';
import { logEvent } from './log';
import { runMigration } from './migration';
import { indexClouds } from './pop';
import { checkSchisms } from './schism';
import { runSettlements } from './settlements';
import { checkStability } from './stability';
import { runStates } from './states';
import { recordStats } from './stats';
import type { SimState } from './types';
import { updateVisibility } from './visibility';

/**
 * One simulation turn, in the order of the specification (§13). Every stage
 * reads the state left by the previous one; within a stage, proposals are
 * computed from one snapshot and applied together, and any remaining
 * ordering (e.g. competing diplomatic offers) is resolved by utility with
 * random tie-breaks, never by array position.
 */
export function step(state: SimState): void {
  if (state.stability.finished) return;
  state.turn += 1;

  // 1. Snapshot of the current state.
  let index = indexClouds(state);
  // 2. What each agent knows.
  const knowledge = buildKnowledge(state, index);
  // 3. Strategic choices and diplomatic proposals.
  chooseStrategies(state, index, knowledge);
  const proposals = proposeActions(state, index, knowledge);
  // 4. Food production and distribution.
  runFood(state);
  // 5. Births and deaths.
  runDemography(state);
  // 6. Migration.
  index = indexClouds(state);
  runMigration(state, index);
  index = indexClouds(state);
  // 7. Contacts and actions between clouds.
  updateContacts(state, index);
  resolveProposals(state, proposals, index, knowledge);
  // 8. Integration, hybridisation, conflicts.
  progressIntegrations(state);
  index = indexClouds(state);
  runConflicts(state, index);
  index = indexClouds(state);
  runHybridization(state, index);
  updateIsolation(state);
  // 9. Cultural composition and cohesion.
  index = indexClouds(state);
  updateCohesion(state, index);
  // 10. Schisms.
  checkSchisms(state, index);
  // 11. Economic links and settlements.
  index = indexClouds(state);
  markExtinct(state, index.pop);
  const service = runSettlements(state, index);
  // 12. States.
  runStates(state, index);
  // 13. Claims and negotiations.
  runBorders(state, index, service);
  // 14. Visibility.
  index = indexClouds(state);
  updateVisibility(state, index);
  // 15. Statistics and end-of-run check.
  recordStats(state, index);
  checkStability(state);
}

export function runTurns(state: SimState, n: number): void {
  for (let i = 0; i < n && !state.stability.finished; i++) step(state);
}

function markExtinct(state: SimState, pop: number[]): void {
  for (const c of state.clouds) {
    if (c.alive && !(pop[c.id] > 0)) {
      c.alive = false;
      c.diedTurn = state.turn;
      for (const s of state.settlements) {
        if (s.alive && s.cloud === c.id) {
          const owner = state.cells[s.hex].groups.length ? state.cells[s.hex].groups[0].cloud : -1;
          if (owner >= 0 && state.clouds[owner].alive) s.cloud = owner;
        }
      }
      logEvent(state, 'extinction', [c.id], 'Население облака исчезло', `${c.name} прекратило существование`);
    }
  }
}
