import { describe, expect, it } from 'vitest';
import { buildKnowledge, chooseStrategies } from '../src/sim/ai';
import { runBorders } from '../src/sim/borders';
import { defaultConfig } from '../src/sim/config';
import { runFood } from '../src/sim/food';
import { createSimulation } from '../src/sim/init';
import { integrateClouds } from '../src/sim/interactions';
import { runMigration } from '../src/sim/migration';
import { indexClouds } from '../src/sim/pop';
import { splitOff } from '../src/sim/schism';
import { computeService } from '../src/sim/settlements';
import { deserializeState, serializeState } from '../src/sim/serialize';
import { runTurns, step } from '../src/sim/turn';
import type { SimState } from '../src/sim/types';
import { block, buildScenario, census, cellsOf, closeTo, framed } from './helpers';

/** One shared 160-turn run of the default world, reused by several checks. */
const baseRun: { state: SimState; negative: string[]; smallOver: string[]; smallSettled: string[] } = (() => {
  const state = createSimulation(defaultConfig(), 'inv-base');
  const negative: string[] = [];
  const smallOver: string[] = [];
  const smallSettled: string[] = [];
  let known = state.settlements.length;
  for (let t = 0; t < 160; t++) {
    step(state);
    for (const cell of state.cells) for (const g of cell.groups) if (g.rural < 0 || g.urban < 0) negative.push(`t${state.turn}`);
    const idx = indexClouds(state);
    for (const c of state.clouds) {
      if (c.alive && c.cls === 'small' && idx.cells[c.id].length > c.maxArea) smallOver.push(`${c.name} t${state.turn}: ${idx.cells[c.id].length}>${c.maxArea}`);
    }
    for (const s of state.settlements.slice(known)) if (state.clouds[s.cloud].cls === 'small') smallSettled.push(s.name);
    known = state.settlements.length;
  }
  return { state, negative, smallOver, smallSettled };
})();

describe('обязательные инварианты (§17.1)', () => {
  it('1. население никогда не становится отрицательным', () => {
    expect(baseRun.negative).toEqual([]);
  });

  it('2. миграция сохраняет численность населения', () => {
    const state = createSimulation(defaultConfig(), 'inv-migration');
    runTurns(state, 40);
    for (let k = 0; k < 5; k++) {
      const before = census(state);
      runFood(state);
      const index = indexClouds(state);
      chooseStrategies(state, index, buildKnowledge(state, index));
      const flows = runMigration(state, index);
      const after = census(state);
      expect(flows.length).toBeGreaterThan(0);
      expect(closeTo(before.total, after.total, 1e-10)).toBe(true);
      for (const [cloud, n] of before.byCloud) expect(closeTo(n, after.byCloud.get(cloud) ?? 0, 1e-10)).toBe(true);
      for (const [culture, n] of before.byCulture) expect(closeTo(n, after.byCulture.get(culture) ?? 0, 1e-10)).toBe(true);
      step(state);
    }
  });

  it('3. интеграция не создаёт дубликатов населения', () => {
    const state = createSimulation(defaultConfig(), 'inv-integration');
    runTurns(state, 20);
    const large = state.clouds.find((c) => c.cls === 'large' && c.alive)!;
    const smalls = state.clouds.filter((c) => c.cls !== 'large' && c.alive).slice(0, 3);
    const before = census(state);
    const absorbed = smalls.reduce((s, c) => s + (before.byCloud.get(c.id) ?? 0), 0);
    for (const s of smalls) integrateClouds(state, large.id, s.id);
    const after = census(state);
    expect(closeTo(before.total, after.total)).toBe(true);
    for (const [race, n] of before.byRace) expect(closeTo(n, after.byRace.get(race) ?? 0)).toBe(true);
    for (const [culture, n] of before.byCulture) expect(closeTo(n, after.byCulture.get(culture) ?? 0)).toBe(true);
    for (const s of smalls) expect(after.byCloud.get(s.id) ?? 0).toBe(0);
    expect(closeTo(after.byCloud.get(large.id)!, (before.byCloud.get(large.id) ?? 0) + absorbed)).toBe(true);
    // Integrated peoples keep their own culture inside the large cloud.
    for (const s of smalls) expect(large.groups.some((g) => g.culture === s.culture)).toBe(true);
  });

  it('4. раскол перераспределяет население без дублирования', () => {
    const state = createSimulation(defaultConfig(), 'inv-schism');
    runTurns(state, 30);
    const large = state.clouds.find((c) => c.cls === 'large' && c.alive)!;
    const cells = cellsOf(state, large.id);
    const half = cells.slice(0, Math.ceil(cells.length / 2));
    const before = census(state);
    const child = splitOff(state, large, half, -1, -1, 40, [], 'тест')!;
    const after = census(state);
    expect(child).not.toBeNull();
    expect(closeTo(before.total, after.total)).toBe(true);
    for (const [culture, n] of before.byCulture) expect(closeTo(n, after.byCulture.get(culture) ?? 0)).toBe(true);
    expect(closeTo((after.byCloud.get(large.id) ?? 0) + (after.byCloud.get(child.id) ?? 0), before.byCloud.get(large.id)!)).toBe(true);
    expect(after.byCloud.get(child.id)!).toBeGreaterThan(0);
  });

  it('5. на одном гексе могут сосуществовать несколько культур', () => {
    const mixed = baseRun.state.cells.filter((c) => new Set(c.groups.map((g) => g.culture)).size >= 2);
    expect(mixed.length).toBeGreaterThan(0);
  });

  it('6. малые облака не создают поселений', () => {
    expect(baseRun.state.settlements.length).toBeGreaterThan(0);
    expect(baseRun.smallSettled).toEqual([]);
  });

  it('7. малые облака не превышают предельный ареал', () => {
    expect(baseRun.smallOver).toEqual([]);
  });

  it('8. один и тот же избыток пищи не расходуется несколькими поселениями', () => {
    const state = baseRun.state;
    const result = runFood(state);
    const shippedFrom = new Map<number, number>();
    for (const f of result.flows) {
      expect(f.delivered).toBeLessThanOrEqual(f.shipped + 1e-9);
      shippedFrom.set(f.from, (shippedFrom.get(f.from) ?? 0) + f.shipped);
    }
    expect(result.flows.length).toBeGreaterThan(0);
    for (const [from, shipped] of shippedFrom) expect(shipped).toBeLessThanOrEqual(result.initialSurplus[from] + 1e-6);
    // Nobody receives more than its deficit.
    state.cells.forEach((c) => {
      if (c.food.need > 0) expect(c.food.produced + c.food.fromStock + c.food.imported).toBeGreaterThan(-1e-9);
      expect(c.food.ratio).toBeLessThanOrEqual(1 + 1e-9);
    });
    // Service demand: Huff shares of one cell never add up to more than one.
    const info = computeService(state);
    for (const tier of info.shares) for (const list of tier) expect(list.reduce((s, x) => s + x.share, 0)).toBeLessThan(1);
  });

  it('9. город не растёт бесконечно без снабжения и занятости', () => {
    // An isolated fertile island: a city placed there has no market and no imports.
    const W = 9;
    const H = 7;
    const state = buildScenario({
      width: W, height: H,
      terrainAt: framed((c, r) => (c >= 3 && c <= 5 && r >= 2 && r <= 4 ? 'fertile_plain' : 'ocean'), W, H),
      clouds: [{ cls: 'large', race: 0, cells: block(3, 2, 3, 3), density: 0.9 }],
    });
    const hex = 3 * W + 4;
    state.settlements.push({
      id: 0, name: 'Тест', hex, level: 3, cloud: 0, foundedTurn: 0, alive: true, abandonedTurn: -1, upStreak: 0, downStreak: 0,
      supplyAvg: 1, jobs: 0, servedPop: 0, potentialJobs: 0, zoneSurplus: 0, peakLevel: 3, blockers: [],
    });
    state.cells[hex].settlement = 0;
    for (const g of state.cells[hex].groups) {
      g.urban = 600;
    }
    runTurns(state, 60);
    const urban = state.cells[hex].groups.reduce((s, g) => s + g.urban, 0);
    expect(urban).toBeLessThan(150);
    const s = state.settlements[0];
    expect(!s.alive || s.level < 3).toBe(true);
  });

  it('10. политическое присоединение клетки не меняет культуру населения', () => {
    const state = createSimulation(defaultConfig(), 'inv-politics');
    runTurns(state, 220);
    expect(state.polities.some((p) => p.alive)).toBe(true);
    const before = JSON.stringify(state.cells.map((c) => c.groups));
    const info = computeService(state);
    runBorders(state, indexClouds(state), info);
    expect(state.politics.claims.some((c) => c.length > 0)).toBe(true);
    expect(JSON.stringify(state.cells.map((c) => c.groups))).toBe(before);
  });

  it('11. при одинаковом seed результаты воспроизводятся', () => {
    const a = createSimulation(defaultConfig(), 'repro');
    const b = createSimulation(defaultConfig(), 'repro');
    runTurns(a, 120);
    runTurns(b, 120);
    expect(serializeState(a)).toBe(serializeState(b));
    const c = createSimulation(defaultConfig(), 'repro-other');
    runTurns(c, 120);
    expect(serializeState(c)).not.toBe(serializeState(a));
  });

  it('12. границы и население сохраняются при записи и загрузке', () => {
    const a = createSimulation(defaultConfig(), 'save-load');
    runTurns(a, 200);
    const text = serializeState(a);
    const b = deserializeState(text);
    expect(serializeState(b)).toBe(text);
    expect(census(b).total).toBeCloseTo(census(a).total, 6);
    expect(b.politics.recognized).toEqual(a.politics.recognized);
    expect(b.treaties).toEqual(a.treaties);
    // The loaded copy continues exactly like the original.
    runTurns(a, 30);
    runTurns(b, 30);
    expect(serializeState(b)).toBe(serializeState(a));
  });
});
