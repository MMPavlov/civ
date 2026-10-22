import { getGeo } from './geo';
import { indexClouds, type CloudIndex } from './pop';
import type { SimState } from './types';

/**
 * Knowledge model. A cloud sees every cell within `sightRadius` of a cell it
 * populates ("visible now") and remembers everything it has ever seen
 * ("explored"). Agents may plan only over explored geography and may only
 * reason about other clouds they currently see or have contact with.
 * Observer modes in the UI read the same data and never write to it.
 */
export function updateVisibility(state: SimState, index: CloudIndex = indexClouds(state)): void {
  const geo = getGeo(state);
  for (const cloud of state.clouds) {
    if (!cloud.alive) continue;
    for (const idx of index.cells[cloud.id]) {
      for (const v of geo.sight[idx]) cloud.explored[v] = 1;
    }
  }
}

export function visibleCells(state: SimState, cloudId: number, index: CloudIndex): Set<number> {
  const geo = getGeo(state);
  const out = new Set<number>();
  for (const idx of index.cells[cloudId] ?? []) for (const v of geo.sight[idx]) out.add(v);
  return out;
}

/** Other clouds that `cloudId` can currently see (present on a visible cell). */
export function visibleClouds(state: SimState, cloudId: number, visible: Set<number>): Set<number> {
  const out = new Set<number>();
  for (const idx of visible) {
    for (const g of state.cells[idx].groups) if (g.cloud !== cloudId) out.add(g.cloud);
  }
  return out;
}
