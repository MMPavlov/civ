import { getGeo } from './geo';
import { cellRural, cellTotal, dominantCloud } from './pop';
import { flowFactor } from './relations';
import type { SimState } from './types';

/**
 * Food production and distribution (turn stage 4).
 *
 * Production on a cell with rural labour L:
 *     F = F_max · (1 − e^(−L / L0)),   L0 = laborScale · K
 * which has diminishing marginal returns and the hard ceiling F_max.
 * Need C = N · foodPerCapita + settlement upkeep; balance S = F − C.
 *
 * Deficits are covered first from the cell's own stock, then by imports.
 * Imports use an iterative proportional allocation computed simultaneously
 * for all cells (no processing-order advantage): each supplier splits its
 * *remaining* surplus between reachable consumers in proportion to
 *     demand · A(s,c) · flow(s,c) · pull(c),   A = e^(−λ·d(s,c))
 * and only A of what is shipped arrives (transport loss). Offers exceeding a
 * consumer's demand are scaled down and the unshipped food stays with the
 * supplier for the next round. A unit of surplus is therefore shipped at
 * most once: the same surplus can never feed two settlements.
 */
export interface FoodFlow {
  from: number;
  to: number;
  shipped: number;
  delivered: number;
}

export interface FoodResult {
  flows: FoodFlow[];
  totalProduced: number;
  totalNeed: number;
  totalShipped: number;
  totalDelivered: number;
  /** Surplus available at each cell before transfers (for invariant checks). */
  initialSurplus: number[];
}

export function settlementUpkeep(state: SimState, cellIdx: number): number {
  const sid = state.cells[cellIdx].settlement;
  if (sid < 0) return 0;
  const s = state.settlements[sid];
  return s.alive ? state.config.settlements.upkeep[s.level - 1] : 0;
}

export function production(state: SimState, cellIdx: number, ruralLabour: number): number {
  const hex = state.map.hexes[cellIdx];
  if (hex.capacity <= 0 || ruralLabour <= 0) return 0;
  const cfg = state.config.food;
  const fmax = hex.agriPotential * cfg.yieldFactor;
  const l0 = Math.max(1, cfg.laborScale * hex.capacity);
  return fmax * (1 - Math.exp(-ruralLabour / l0));
}

export function runFood(state: SimState): FoodResult {
  const cfg = state.config.food;
  const geo = getGeo(state);
  const n = state.cells.length;
  const surplus = new Array<number>(n).fill(0);
  const demand = new Array<number>(n).fill(0);
  const dominant = new Array<number>(n).fill(-1);
  let totalProduced = 0;
  let totalNeed = 0;

  for (let i = 0; i < n; i++) {
    const cell = state.cells[i];
    const N = cellTotal(cell);
    const f = cell.food;
    if (N <= 0) {
      f.produced = 0; f.need = 0; f.imported = 0; f.exported = 0; f.fromStock = 0; f.ratio = 1; f.surplus = 0;
      cell.stock *= 1 - cfg.spoilage;
      continue;
    }
    const produced = production(state, i, cellRural(cell));
    const need = N * state.config.demography.foodPerCapita + settlementUpkeep(state, i);
    totalProduced += produced;
    totalNeed += need;
    f.produced = produced;
    f.need = need;
    f.imported = 0;
    f.exported = 0;
    f.surplus = produced - need;
    dominant[i] = dominantCloud(cell);
    let deficit = need - produced;
    f.fromStock = 0;
    if (deficit > 0) {
      const take = Math.min(cell.stock, deficit);
      cell.stock -= take;
      f.fromStock = take;
      deficit -= take;
      demand[i] = deficit;
    } else {
      surplus[i] = -deficit;
    }
  }
  const initialSurplus = [...surplus];

  // Candidate supplier -> consumer pairs.
  type Pair = { s: number; c: number; a: number; w: number };
  const pairsBySupplier = new Map<number, Pair[]>();
  for (let c = 0; c < n; c++) {
    if (demand[c] <= 0) continue;
    const sid = state.cells[c].settlement;
    const level = sid >= 0 && state.settlements[sid].alive ? state.settlements[sid].level : 0;
    const pull = 1 + 0.5 * level;
    for (const { idx: s, cost } of geo.reach[c]) {
      if (cost > cfg.transportRadius) break;
      if (s === c || surplus[s] <= 0) continue;
      const flow = flowFactor(state, dominant[s], dominant[c]);
      if (flow <= 0) continue;
      const a = Math.exp(-cfg.transportLambda * cost);
      let list = pairsBySupplier.get(s);
      if (!list) pairsBySupplier.set(s, (list = []));
      list.push({ s, c, a, w: a * flow * pull });
    }
  }

  const shippedPair = new Map<number, number>(); // key s*n+c -> shipped
  const deliveredPair = new Map<number, number>();
  for (let round = 0; round < cfg.allocationRounds; round++) {
    const offers: Array<{ p: Pair; ship: number }> = [];
    const incoming = new Array<number>(n).fill(0);
    for (const [s, list] of pairsBySupplier) {
      if (surplus[s] <= 1e-9) continue;
      let total = 0;
      for (const p of list) if (demand[p.c] > 1e-9) total += p.w * demand[p.c];
      if (total <= 0) continue;
      for (const p of list) {
        if (demand[p.c] <= 1e-9) continue;
        const ship = (surplus[s] * p.w * demand[p.c]) / total;
        offers.push({ p, ship });
        incoming[p.c] += ship * p.a;
      }
    }
    if (!offers.length) break;
    const scale = new Array<number>(n).fill(1);
    for (let c = 0; c < n; c++) if (incoming[c] > demand[c] && incoming[c] > 0) scale[c] = demand[c] / incoming[c];
    let moved = 0;
    for (const { p, ship } of offers) {
      const shipped = ship * scale[p.c];
      if (shipped <= 0) continue;
      const delivered = shipped * p.a;
      surplus[p.s] -= shipped;
      demand[p.c] -= delivered;
      const k = p.s * n + p.c;
      shippedPair.set(k, (shippedPair.get(k) ?? 0) + shipped);
      deliveredPair.set(k, (deliveredPair.get(k) ?? 0) + delivered);
      moved += shipped;
    }
    for (let i = 0; i < n; i++) {
      if (surplus[i] < 0) surplus[i] = 0;
      if (demand[i] < 0) demand[i] = 0;
    }
    if (moved < 1e-6) break;
  }

  const flows: FoodFlow[] = [];
  let totalShipped = 0;
  let totalDelivered = 0;
  for (const [k, shipped] of shippedPair) {
    const from = Math.floor(k / n);
    const to = k % n;
    const delivered = deliveredPair.get(k) ?? 0;
    flows.push({ from, to, shipped, delivered });
    totalShipped += shipped;
    totalDelivered += delivered;
    state.cells[from].food.exported += shipped;
    state.cells[to].food.imported += delivered;
  }

  for (let i = 0; i < n; i++) {
    const cell = state.cells[i];
    const f = cell.food;
    if (f.need <= 0) continue;
    const consumed = f.need - demand[i];
    f.ratio = Math.max(0, Math.min(1, consumed / f.need));
    const cap = cfg.stockPerCapita * cellTotal(cell) + 5;
    cell.stock = Math.min(cap, cell.stock * (1 - cfg.spoilage) + surplus[i]);
  }

  return { flows, totalProduced, totalNeed, totalShipped, totalDelivered, initialSurplus };
}
