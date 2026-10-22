import { useEffect, useRef, useState } from 'react';
import { aggregate, type RunSummary } from '../sim/batch';
import type { SimConfig } from '../sim/config';
import { downloadText } from './download';
import { num, pct } from './labels';

interface Props {
  config: SimConfig;
}

/** Series of simulations with different seeds, run in a Web Worker without per-turn rendering. */
export function BatchPanel({ config }: Props) {
  const [runs, setRuns] = useState(8);
  const [prefix, setPrefix] = useState('exp');
  const [maxTurns, setMaxTurns] = useState(config.sim.maxTurns);
  const [results, setResults] = useState<RunSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const start = () => {
    worker.current?.terminate();
    const w = new Worker(new URL('./batch.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setResults([]);
    setBusy(true);
    w.onmessage = (e) => {
      if (e.data.type === 'run') setResults((r) => [...r, e.data.summary as RunSummary]);
      if (e.data.type === 'done') setBusy(false);
    };
    const cfg = structuredClone(config);
    cfg.sim.maxTurns = maxTurns;
    w.postMessage({ config: cfg, seeds: Array.from({ length: runs }, (_, i) => `${prefix}-${i + 1}`) });
  };
  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  };

  const agg = aggregate(results);
  const m = agg.mean;
  return (
    <div className="card">
      <div className="filters">
        <label className="field inline"><span>Запусков</span><input type="number" min={1} max={200} value={runs} onChange={(e) => setRuns(Number(e.target.value))} /></label>
        <label className="field inline"><span>Префикс seed</span><input value={prefix} onChange={(e) => setPrefix(e.target.value)} /></label>
        <label className="field inline"><span>Макс. ходов</span><input type="number" min={10} max={2000} value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))} /></label>
      </div>
      <div className="filters">
        {!busy ? <button className="primary" onClick={start}>Запустить серию</button> : <button onClick={stop}>Остановить</button>}
        {results.length > 0 && <button onClick={() => downloadText(`ccs-batch-${prefix}.json`, JSON.stringify({ runs: results, aggregate: agg }, null, 2))}>Экспорт JSON</button>}
        {busy && <span className="muted">выполнено {results.length} из {runs}…</span>}
      </div>
      <p className="muted small">Используется текущая конфигурация (вкладка «Параметры»). Каждый запуск идёт до стабилизации или лимита ходов.</p>
      {results.length > 0 && (
        <>
          <h4>Средние показатели ({results.length} запусков)</h4>
          <dl className="kv">
            <dt>Больших / средних облаков</dt><dd>{num(m.largeClouds ?? 0, 1)} / {num(m.mediumClouds ?? 0, 1)}</dd>
            <dt>Расколов</dt><dd>{num(m.schisms ?? 0, 1)}</dd>
            <dt>Доля интегрированных малых народов</dt><dd>{pct(m.integratedSmallShare ?? 0)}</dd>
            <dt>Деревень / городков / городов</dt><dd>{num(m.villages ?? 0, 1)} / {num(m.towns ?? 0, 1)} / {num(m.cities ?? 0, 1)}</dd>
            <dt>Среднее население города</dt><dd>{num(m.avgCityPop ?? 0)}</dd>
            <dt>Доля городского населения</dt><dd>{pct(m.urbanShare ?? 0, 1)}</dd>
            <dt>Государств образовано</dt><dd>{num(m.statesFormed ?? 0, 1)}</dd>
            <dt>Согласованных границ</dt><dd>{num(m.treaties ?? 0, 1)}</dd>
            <dt>Запусков со стабилизацией</dt><dd>{pct(agg.stabilizedShare)}</dd>
          </dl>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Seed</th><th>Ходов</th><th>Стаб.</th><th>Б/С/М</th><th>Раск.</th><th>Интегр.</th><th>Дер/Гк/Гор</th><th>Гор. доля</th><th>Гос.</th><th>Догов.</th><th>Войны</th></tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.seed}>
                    <td>{r.seed}</td><td>{r.turns}</td><td>{r.stabilized ? 'да' : 'нет'}</td>
                    <td>{r.largeClouds}/{r.mediumClouds}/{r.smallClouds}</td><td>{r.schisms}</td><td>{r.integrations}</td>
                    <td>{r.villages}/{r.towns}/{r.cities}</td><td>{pct(r.urbanShare, 1)}</td><td>{r.statesFormed}</td><td>{r.treaties}</td><td>{r.wars}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
