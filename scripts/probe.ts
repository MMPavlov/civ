// Developer probe: run a simulation and print a compact summary.
// Usage: npx tsx scripts/probe.ts [seed] [turns] [--detail]
import { defaultConfig } from '../src/sim/config';
import { createSimulation } from '../src/sim/init';
import { cellTotal, cellUrban, indexClouds, totalPopulation } from '../src/sim/pop';
import { runTurns } from '../src/sim/turn';

const seed = process.argv[2] ?? 'probe';
const turns = Number(process.argv[3] ?? 100);
const detail = process.argv.includes('--detail');
const cfg = defaultConfig();
const t0 = performance.now();
const s = createSimulation(cfg, seed);
const terrainCounts: Record<string, number> = {};
for (const h of s.map.hexes) terrainCounts[h.terrain] = (terrainCounts[h.terrain] ?? 0) + 1;
console.log('terrain', JSON.stringify(terrainCounts), 'rivers', s.map.hexes.filter((h) => h.river > 0).length);
console.log('clouds', s.clouds.length, 'pop0', Math.round(totalPopulation(s)));
const t1 = performance.now();
for (let k = 0; k < turns && !s.stability.finished; k += 25) {
  runTurns(s, 25);
  const idx = indexClouds(s);
  const h = s.history[s.history.length - 1];
  console.log(
    `t=${s.turn} pop=${Math.round(h.totalPop)} urban=${Math.round(h.urbanPop)} vil=${h.villages} town=${h.towns} city=${h.cities} states=${h.states} wars=${h.wars} disputes=${h.disputes} delim=${h.delimitedShare.toFixed(2)} alive=${s.clouds.filter((c) => c.alive).length}`,
    '| large:', s.clouds.filter((c) => c.cls === 'large' && c.alive).map((c) => `${c.name}:${Math.round(idx.pop[c.id])}/${idx.cells[c.id].length}/coh${c.cohesion.toFixed(2)}/L${c.load.toFixed(1)}of${c.capacity.toFixed(1)}`).join(' '),
  );
}
const t2 = performance.now();
console.log(`init ${(t1 - t0).toFixed(0)}ms, ${s.turn} turns ${(t2 - t1).toFixed(0)}ms; finished=${s.stability.finished} ${s.stability.reason}`);
const types: Record<string, number> = {};
for (const e of s.events) types[e.type] = (types[e.type] ?? 0) + 1;
console.log('events', JSON.stringify(types));
console.log('counters', JSON.stringify(s.counters, (_k, v) => (typeof v === 'number' ? Math.round(v) : v)));
if (detail) {
  const populated = s.cells.filter((c) => cellTotal(c) > 1).length;
  console.log('populated cells', populated);
  for (const st of s.settlements.filter((x) => x.alive).sort((a, b) => b.level - a.level)) {
    const cell = s.cells[st.hex];
    console.log(
      `  ${st.name} L${st.level} hex(${s.map.hexes[st.hex].col},${s.map.hexes[st.hex].row}) ${s.map.hexes[st.hex].terrain} urban=${Math.round(cellUrban(cell))} N=${Math.round(cellTotal(cell))} jobs=${Math.round(st.jobs)} pot=${Math.round(st.potentialJobs)} supply=${st.supplyAvg.toFixed(2)} block=[${st.blockers.join('; ')}]`,
    );
  }
  for (const p of s.polities) console.log('  polity', p.name, 'alive', p.alive, 'cloud', s.clouds[p.cloud].name, 'from', p.foundedTurn);
  for (const t of s.treaties) console.log('  treaty', t.a, t.b, t.kinds.join(','), 'cells', t.cells.length, 'alive', t.alive, t.endReason);
  const last = s.events.slice(-25);
  for (const e of last) console.log(`  [${e.turn}] ${e.type}: ${e.result} (${e.cause})`);
}
