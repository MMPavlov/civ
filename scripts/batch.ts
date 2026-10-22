// Batch experiments from the command line.
// Usage: npm run batch -- [runs=10] [seedPrefix=batch] [config.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { runBatch } from '../src/sim/batch';
import { defaultConfig } from '../src/sim/config';
import { parseConfig } from '../src/sim/serialize';

const runs = Number(process.argv[2] ?? 10);
const prefix = process.argv[3] ?? 'batch';
const configPath = process.argv[4];
const config = configPath ? parseConfig(readFileSync(configPath, 'utf8')) : defaultConfig();
const seeds = Array.from({ length: runs }, (_, i) => `${prefix}-${i + 1}`);

const result = runBatch(config, seeds, (r, i) => {
  console.log(
    `${String(i + 1).padStart(3)} ${r.seed.padEnd(14)} turns=${r.turns} ${r.stabilized ? 'стабилизация' : 'лимит'} ` +
      `L/M/S=${r.largeClouds}/${r.mediumClouds}/${r.smallClouds} расколы=${r.schisms} интеграции=${r.integrations} ` +
      `дер/гор/город=${r.villages}/${r.towns}/${r.cities} город.доля=${(r.urbanShare * 100).toFixed(1)}% ` +
      `гос=${r.statesFormed} договоры=${r.treaties} войны=${r.wars} (${r.ms} мс)`,
  );
});

const m = result.aggregate.mean;
const f = (x: number | undefined, d = 1) => (x ?? 0).toFixed(d);
console.log('\nСредние по серии:');
console.log(`  больших облаков ${f(m.largeClouds)}, средних ${f(m.mediumClouds)}, малых ${f(m.smallClouds)}`);
console.log(`  расколов ${f(m.schisms)}, доля интегрированных малых народов ${f((m.integratedSmallShare ?? 0) * 100)}%`);
console.log(`  деревень ${f(m.villages)}, городков ${f(m.towns)}, городов ${f(m.cities)}, среднее население города ${f(m.avgCityPop, 0)}`);
console.log(`  доля городского населения ${f((m.urbanShare ?? 0) * 100)}%`);
console.log(`  государств образовано ${f(m.statesFormed)}, согласованных границ ${f(m.treaties)}`);
console.log(`  доля запусков со стабилизацией ${f(result.aggregate.stabilizedShare * 100, 0)}%`);
const out = `batch-results-${prefix}.json`;
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`\nРезультаты сохранены в ${out}`);
