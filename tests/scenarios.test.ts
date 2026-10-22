import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '../src/sim/config';
import { effectiveCapacity } from '../src/sim/demography';
import { getGeo } from '../src/sim/geo';
import { createSimulation } from '../src/sim/init';
import { integrateClouds } from '../src/sim/interactions';
import { cellTotal, cellUrban, indexClouds, totalPopulation } from '../src/sim/pop';
import { getRelation } from '../src/sim/relations';
import { runTurns, step } from '../src/sim/turn';
import { statesInContact } from '../src/sim/stability';
import type { CharacterId, RelationStatus, SimState, TerrainId } from '../src/sim/types';
import { block, buildScenario, census, framed } from './helpers';

function hexDist(state: SimState, a: number, b: number): number {
  const ha = state.map.hexes[a];
  const hb = state.map.hexes[b];
  const dq = ha.q - hb.q;
  const dr = ha.r - hb.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

describe('проверочные сценарии (§17.2)', () => {
  it('А — естественное расселение: зависит от географии, рост ограничен', () => {
    const cfg = mergeConfig(defaultConfig(), { clouds: { counts: { large: 1, medium: 0, small: 0 } } });
    const state = createSimulation(cfg, 'scenario-a');
    const p0 = totalPopulation(state);
    runTurns(state, 200);
    const p200 = totalPopulation(state);
    runTurns(state, 100);
    const p300 = totalPopulation(state);
    const capacity = state.map.hexes.reduce((s, _h, i) => s + effectiveCapacity(state, i), 0);
    expect(p200).toBeGreaterThan(p0 * 2);
    expect(p300).toBeLessThan(capacity);
    // Growth slows down: the last 100 turns add relatively less than the first 200.
    expect(p300 / p200).toBeLessThan(p200 / p0);
    // Density follows geography: rich farmland is denser than marginal land.
    const dens = (types: TerrainId[]) => {
      const cells = state.map.hexes.filter((h) => types.includes(h.terrain) && cellTotal(state.cells[h.idx]) > 1);
      return cells.length ? cells.reduce((s, h) => s + cellTotal(state.cells[h.idx]), 0) / cells.length : 0;
    };
    const rich = dens(['fertile_plain', 'river_meadow']);
    const poor = dens(['desert', 'tundra', 'hills']);
    expect(rich).toBeGreaterThan(poor * 1.5);
  });

  it('Б — смешанная территория: два облака делят долину без присоединения клеток', () => {
    const W = 16;
    const H = 8;
    const state = buildScenario({
      width: W, height: H,
      terrainAt: framed((_c, r) => (r === 1 || r === H - 2 ? 'mountains' : 'plain'), W, H),
      clouds: [
        { cls: 'large', race: 0, character: 'trader', cells: block(1, 3, 2, 2), density: 0.5 },
        { cls: 'large', race: 0, character: 'trader', cells: block(W - 3, 3, 2, 2), density: 0.5 },
      ],
      seed: 'scenario-b',
    });
    runTurns(state, 200);
    const mixed = state.cells.filter((c) => {
      const n = cellTotal(c);
      if (n < 10) return false;
      const a = c.groups.filter((g) => g.cloud === 0).reduce((s, g) => s + g.rural + g.urban, 0);
      const b = c.groups.filter((g) => g.cloud === 1).reduce((s, g) => s + g.rural + g.urban, 0);
      return a / n > 0.15 && b / n > 0.15;
    });
    expect(mixed.length).toBeGreaterThan(0);
    // Without states nobody owns the shared cells.
    for (const idx of mixed.map((c) => state.cells.indexOf(c))) {
      if (state.polities.length === 0) expect(state.politics.control[idx]).toBe(-1);
    }
    expect(getRelation(state, 0, 1)).toBeDefined();
  });

  it('В — интеграция: разные исходы для малых народов с разной обособленностью', () => {
    const outcomes = new Map<number, Array<RelationStatus | 'integrated' | 'none'>>();
    const isolations = [5, 30, 55, 80, 97];
    for (const seed of ['v1', 'v2', 'v3', 'v4']) {
      const W = 14;
      const H = 10;
      const smallCells: Array<[number, number]> = [[3, 2], [10, 2], [3, 7], [10, 7], [7, 8]];
      const state = buildScenario({
        width: W, height: H,
        terrainAt: framed(() => 'fertile_plain', W, H),
        clouds: [
          { cls: 'large', race: 0, character: 'integrator', cells: block(6, 4, 3, 2), density: 0.5 },
          ...isolations.map((iso, k) => ({ cls: 'small' as const, race: k % 2 === 0 ? 0 : 2, isolation: iso, cells: [smallCells[k]], density: 0.5 })),
        ],
        seed: `scenario-${seed}`,
      });
      runTurns(state, 160);
      isolations.forEach((iso, k) => {
        const c = state.clouds[k + 1];
        const rel = getRelation(state, 0, c.id);
        const result = c.absorbedInto === 0 ? 'integrated' : rel ? rel.status : 'none';
        const list = outcomes.get(iso) ?? [];
        list.push(result);
        outcomes.set(iso, list);
      });
    }
    const all = new Set([...outcomes.values()].flat());
    expect(all.size).toBeGreaterThanOrEqual(2);
    expect(all.has('integrated')).toBe(true);
    // Strongly isolated peoples (above the integration gate) are never integrated.
    expect(outcomes.get(97)!.includes('integrated')).toBe(false);
    const rate = (iso: number) => outcomes.get(iso)!.filter((x) => x === 'integrated').length;
    expect(rate(5) + rate(30)).toBeGreaterThan(rate(80) + rate(97));
  });

  it('Г — культурная перегрузка: нагрузка снижает сплочённость, ведёт к гибридизации или расколу', () => {
    const W = 18;
    const H = 12;
    const make = (overload: boolean) => {
      const smallCells: Array<[number, number]> = [[2, 2], [15, 2], [2, 9], [15, 9], [8, 10], [8, 1]];
      const state = buildScenario({
        width: W, height: H,
        terrainAt: framed(() => 'fertile_plain', W, H),
        clouds: [
          { cls: 'large', race: 1, character: 'integrator', cells: block(7, 5, 3, 2), density: 0.6 },
          ...smallCells.map((cell, k) => ({ cls: 'small' as const, race: [2, 3, 4, 5, 2, 3][k], isolation: 70, cells: [cell] as Array<[number, number]>, density: 0.9 })),
        ],
        seed: 'scenario-g',
        config: { culture: { schismMinPop: 60 } },
      });
      runTurns(state, 40);
      if (overload) for (let k = 1; k <= smallCells.length; k++) if (state.clouds[k].alive) integrateClouds(state, 0, k);
      return state;
    };
    const control = make(false);
    const loaded = make(true);
    const total = census(loaded).total;
    runTurns(control, 10);
    runTurns(loaded, 10);
    expect(loaded.clouds[0].load).toBeGreaterThan(loaded.clouds[0].capacity);
    expect(loaded.clouds[0].cohesion).toBeLessThan(control.clouds[0].cohesion);
    expect(census(loaded).total).toBeGreaterThan(total * 0.9);
    runTurns(loaded, 250);
    const c = loaded.counters;
    const assimilation = loaded.events.filter((e) => e.type === 'assimilation').length;
    expect(c.hybrids + assimilation + c.schisms).toBeGreaterThan(0);
  });

  it('Д — плодородная равнина: иерархическая сеть, а не город на каждом гексе', () => {
    const W = 26;
    const H = 18;
    const state = buildScenario({
      width: W, height: H,
      terrainAt: framed(() => 'fertile_plain', W, H),
      clouds: [{ cls: 'large', race: 0, character: 'expansionist', cells: block(11, 8, 3, 3), density: 0.6 }],
      seed: 'scenario-d',
    });
    runTurns(state, 280);
    const alive = state.settlements.filter((s) => s.alive);
    const populated = state.cells.filter((c) => cellTotal(c) > 20).length;
    const v = alive.filter((s) => s.level === 1).length;
    const t = alive.filter((s) => s.level === 2).length;
    const city = alive.filter((s) => s.level === 3).length;
    expect(populated).toBeGreaterThan(200);
    expect(alive.length).toBeGreaterThan(3);
    // A rural network: few settlements per populated cell, very few towns and cities.
    expect(alive.length / populated).toBeLessThan(0.2);
    expect((t + city) / populated).toBeLessThan(0.05);
    expect(city).toBeLessThanOrEqual(t + 1);
    expect(v).toBeGreaterThanOrEqual(t);
    // Higher-order centres keep their distance; a village may sit next to a centre that grew later.
    const higher = alive.filter((s) => s.level >= 2);
    for (let i = 0; i < higher.length; i++) {
      for (let j = i + 1; j < higher.length; j++) expect(hexDist(state, higher[i].hex, higher[j].hex)).toBeGreaterThanOrEqual(3);
    }
    let adjacent = 0;
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) if (hexDist(state, alive[i].hex, alive[j].hex) < 2) adjacent++;
    expect(adjacent).toBeLessThanOrEqual(Math.ceil(alive.length * 0.1));
  });

  it('Е — речная долина: поселения концентрируются у реки', () => {
    const W = 24;
    const H = 16;
    const riverRow = 8;
    const river: Array<[number, number]> = [];
    for (let c = 1; c < W - 1; c++) river.push([c, riverRow]);
    const state = buildScenario({
      width: W, height: H,
      terrainAt: framed((c, r) => (c === W - 2 && r === riverRow ? 'lake' : 'plain'), W, H),
      rivers: [river],
      clouds: [{ cls: 'large', race: 0, character: 'expansionist', cells: block(10, 7, 3, 3), density: 0.6 }],
      seed: 'scenario-e',
    });
    runTurns(state, 260);
    const geo = getGeo(state);
    const nearRiver = (i: number) => state.map.hexes[i].river > 0 || geo.neighbors[i].some((n) => state.map.hexes[n].river > 0);
    const alive = state.settlements.filter((s) => s.alive);
    let urbanNear = 0;
    let urbanAll = 0;
    let popNear = 0;
    let popAll = 0;
    state.cells.forEach((c, i) => {
      const u = cellUrban(c);
      const n = cellTotal(c);
      urbanAll += u;
      popAll += n;
      if (nearRiver(i)) {
        urbanNear += u;
        popNear += n;
      }
    });
    expect(alive.length).toBeGreaterThan(2);
    // Urban people (non-farm centres) concentrate by the river far more than people in general.
    expect(urbanNear / urbanAll).toBeGreaterThan(1.5 * (popNear / popAll));
    // Higher-order centres (towns and cities) mostly sit by the river.
    const higher = alive.filter((s) => s.level >= 2);
    expect(higher.length).toBeGreaterThan(0);
    expect(higher.filter((s) => nearRiver(s.hex)).length / higher.length).toBeGreaterThan(0.5);
    // The largest centre sits by the river.
    const biggest = [...alive].sort((a, b) => b.level - a.level || cellUrban(state.cells[b.hex]) - cellUrban(state.cells[a.hex]))[0];
    expect(nearRiver(biggest.hex)).toBe(true);
  });

  it('Ж — малоплодородные земли: крупные города не возникают', () => {
    const W = 22;
    const H = 16;
    const state = buildScenario({
      width: W, height: H,
      terrainAt: framed((c, r) => (['desert', 'tundra', 'hills'] as TerrainId[])[(c * 7 + r * 3) % 3], W, H),
      clouds: [{ cls: 'large', race: 0, character: 'expansionist', cells: block(9, 7, 3, 3), density: 0.6 }],
      seed: 'scenario-zh',
    });
    let maxCities = 0;
    for (let t = 0; t < 260; t++) {
      step(state);
      maxCities = Math.max(maxCities, state.settlements.filter((s) => s.alive && s.level === 3).length);
    }
    expect(maxCities).toBe(0);
    const urban = state.cells.reduce((s, c) => s + cellUrban(c), 0);
    expect(urban / totalPopulation(state)).toBeLessThan(0.05);
  });

  it('З — граница у горного прохода: претензии, переговоры, признание или спор', () => {
    const W = 30;
    const H = 16;
    const passRow = 8;
    const variants: Array<{ seed: string; a: CharacterId; b: CharacterId }> = [
      { seed: 'scenario-z', a: 'expansionist', b: 'conqueror' },
      { seed: 'scenario-z2', a: 'trader', b: 'integrator' },
      { seed: 'scenario-z3', a: 'conqueror', b: 'expansionist' },
    ];
    const seen = new Set<string>();
    for (const v of variants) {
      const state = buildScenario({
        width: W, height: H,
        terrainAt: framed((c, r) => (c === 15 && r !== passRow ? 'mountains' : c === 15 ? 'hills' : 'fertile_plain'), W, H),
        clouds: [
          { cls: 'large', race: 0, character: v.a, cells: block(5, 6, 3, 3), density: 0.6 },
          { cls: 'large', race: 3, character: v.b, cells: block(22, 6, 3, 3), density: 0.6 },
        ],
        seed: v.seed,
        config: { states: { minPopulation: 1200 } },
      });
      let contact = false;
      for (let t = 0; t < 300 && !state.stability.finished; t++) {
        step(state);
        if (statesInContact(state)) contact = true;
      }
      expect(state.polities.filter((p) => p.alive).length).toBeGreaterThanOrEqual(2);
      expect(contact).toBe(true);
      for (const e of state.events) seen.add(e.type);
      // Whatever the outcome, both peoples keep their own culture on their own side.
      const idx = indexClouds(state);
      expect(idx.pop[0]).toBeGreaterThan(0);
      expect(idx.pop[1]).toBeGreaterThan(0);
    }
    expect(seen.has('dispute') || seen.has('negotiation')).toBe(true);
    expect(seen.has('treaty') || seen.has('conflict')).toBe(true);
  });

});
