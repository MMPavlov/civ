import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/sim/config';
import { createSimulation } from '../src/sim/init';
import { indexClouds } from '../src/sim/pop';
import { serializeState } from '../src/sim/serialize';
import { runTurns, step } from '../src/sim/turn';
import { visibleCells } from '../src/sim/visibility';
import { cellFill, MAP_MODES, type Lens } from '../src/ui/mapModes';

describe('информационные ограничения и режимы наблюдателя (§9.3, §14.3)', () => {
  it('переключение наблюдателя и отрисовка карты не влияют на ход симуляции', () => {
    const a = createSimulation(defaultConfig(), 'observer');
    const b = createSimulation(defaultConfig(), 'observer');
    for (let t = 0; t < 60; t++) {
      step(a);
      step(b);
      // Render every map mode for every possible observer of `b`.
      const index = indexClouds(b);
      for (const c of b.clouds.filter((x) => x.alive && x.cls !== 'small')) {
        const lens: Lens = { observer: c.id, explored: c.explored, visible: visibleCells(b, c.id, index) };
        for (const m of MAP_MODES) for (let i = 0; i < b.cells.length; i += 7) cellFill(b, m.id, i, lens);
      }
    }
    expect(serializeState(b)).toBe(serializeState(a));
  });

  it('облака не переселяются на неразведанные клетки', () => {
    const s = createSimulation(defaultConfig(), 'knowledge');
    runTurns(s, 5);
    for (let t = 0; t < 60; t++) {
      const before = s.clouds.map((c) => [...c.explored]);
      const occupied = indexClouds(s).cells.map((cells) => new Set(cells));
      step(s);
      const after = indexClouds(s);
      for (const c of s.clouds) {
        if (!c.alive || !before[c.id]) continue;
        for (const idx of after.cells[c.id] ?? []) {
          if (occupied[c.id]?.has(idx)) continue;
          expect(before[c.id][idx]).toBe(1);
        }
      }
    }
  });
});
