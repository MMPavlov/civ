// Developer probe: print decisions of a given kind.
// Usage: npx tsx scripts/decisions.ts [seed] [turns] [kind|all] [limit]
import { defaultConfig } from '../src/sim/config';
import { createSimulation } from '../src/sim/init';
import { runTurns } from '../src/sim/turn';

const [seed = 'probe', turns = '150', kind = 'integration', limit = '30'] = process.argv.slice(2);
const s = createSimulation(defaultConfig(), seed);
runTurns(s, Number(turns));
const list = s.decisions.filter((d) => d.kind === kind || kind === 'all');
console.log(`${list.length} decisions of kind ${kind}`);
for (const d of list.slice(-Number(limit))) {
  console.log(`[${d.turn}] ${d.accepted ? '+' : '-'} ${d.title}`);
  console.log('     ' + d.reasons.map((r) => `${r.label}=${r.value}`).join('; '));
}
const rels = s.relations.filter((r) => s.clouds[r.a].alive && s.clouds[r.b].alive);
const att = rels.map((r) => r.attitude).sort((a, b) => a - b);
console.log('relations', rels.length, 'attitude quantiles', [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => att[Math.floor(q * (att.length - 1))]?.toFixed(1)).join(' '));
const st: Record<string, number> = {};
for (const r of rels) st[r.status] = (st[r.status] ?? 0) + 1;
console.log('statuses', JSON.stringify(st));
const iso = s.clouds.filter((c) => c.alive && c.cls !== 'large').map((c) => Math.round(c.isolation));
console.log('isolation of small/medium', iso.join(' '));
