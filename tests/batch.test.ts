import { describe, expect, it } from 'vitest';
import { runBatch } from '../src/sim/batch';
import { mergeConfig, defaultConfig } from '../src/sim/config';
import { createSimulation } from '../src/sim/init';
import { parseConfig, serializeConfig } from '../src/sim/serialize';
import { runTurns } from '../src/sim/turn';

describe('пакетные эксперименты и конфигурация (§16, §17.3)', () => {
  it('серия запусков собирает итоговые показатели', () => {
    const cfg = mergeConfig(defaultConfig(), { sim: { maxTurns: 120 } });
    const { runs, aggregate } = runBatch(cfg, ['b-1', 'b-2', 'b-3']);
    expect(runs).toHaveLength(3);
    expect(aggregate.runs).toBe(3);
    for (const r of runs) {
      expect(r.turns).toBeLessThanOrEqual(120);
      expect(r.totalPop).toBeGreaterThan(0);
      expect(r.villages + r.towns + r.cities).toBeGreaterThan(0);
    }
    expect(new Set(runs.map((r) => r.totalPop)).size).toBe(3);
    expect(aggregate.stabilizedShare).toBeGreaterThanOrEqual(0);
  });

  it('изменение параметров влияет на поведение симуляции', () => {
    const base = createSimulation(defaultConfig(), 'cfg-effect');
    const fast = createSimulation(mergeConfig(defaultConfig(), { demography: { baseGrowth: 0.06 } }), 'cfg-effect');
    runTurns(base, 60);
    runTurns(fast, 60);
    const pop = (s: typeof base) => s.history[s.history.length - 1].totalPop;
    expect(pop(fast)).toBeGreaterThan(pop(base) * 1.2);
  });

  it('конфигурация сохраняется и загружается', () => {
    const cfg = mergeConfig(defaultConfig(), { map: { width: 30 }, clouds: { counts: { large: 3 } } });
    const back = parseConfig(serializeConfig(cfg));
    expect(back).toEqual(cfg);
    const s = createSimulation(back, 'cfg-load');
    expect(s.map.width).toBe(30);
    expect(s.clouds.filter((c) => c.cls === 'large')).toHaveLength(3);
  });
});
