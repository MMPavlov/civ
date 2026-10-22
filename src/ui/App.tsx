import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultConfig, type SimConfig } from '../sim/config';
import { createSimulation } from '../sim/init';
import { cellTotal, dominantCloud, indexClouds } from '../sim/pop';
import { deserializeState, serializeState } from '../sim/serialize';
import { levelName } from '../sim/settlements';
import { step } from '../sim/turn';
import type { SimState } from '../sim/types';
import { visibleCells } from '../sim/visibility';
import { BatchPanel } from './BatchPanel';
import { CloudCard, CloudList } from './CloudCard';
import { cloudColor } from './colors';
import { ConfigEditor } from './ConfigEditor';
import { downloadText } from './download';
import { HexCard } from './HexCard';
import { num } from './labels';
import { DecisionLog, EventLog } from './LogPanels';
import { isKnown, isVisibleNow, legendFor, MAP_MODES, type Lens, type MapMode } from './mapModes';
import { MapView } from './MapView';
import { Report } from './Report';
import { StatsPanel } from './StatsPanel';

type Tab = 'hex' | 'cloud' | 'clouds' | 'events' | 'decisions' | 'stats' | 'config' | 'batch' | 'report';
const TABS: Array<{ id: Tab; name: string }> = [
  { id: 'hex', name: 'Гекс' },
  { id: 'cloud', name: 'Облако' },
  { id: 'clouds', name: 'Облака' },
  { id: 'events', name: 'События' },
  { id: 'decisions', name: 'Решения ИИ' },
  { id: 'stats', name: 'Статистика' },
  { id: 'report', name: 'Отчёт' },
  { id: 'config', name: 'Параметры' },
  { id: 'batch', name: 'Эксперименты' },
];

function randomSeed(): string {
  return `ccs-${Math.floor(Math.random() * 1e6)}`;
}

export function App() {
  const [config, setConfig] = useState<SimConfig>(defaultConfig);
  const [seed, setSeed] = useState('ccs-1');
  const sim = useRef<SimState>(null as unknown as SimState);
  if (!sim.current) sim.current = createSimulation(config, seed);
  const [version, setVersion] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(6);
  const [mode, setMode] = useState<MapMode>('clouds');
  const [observer, setObserver] = useState(-1);
  const [tab, setTab] = useState<Tab>('hex');
  const [selHex, setSelHex] = useState(-1);
  const [selCloud, setSelCloud] = useState(-1);
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const state = sim.current;

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const stepN = useCallback(
    (n: number) => {
      for (let i = 0; i < n && !sim.current.stability.finished; i++) step(sim.current);
      bump();
    },
    [bump],
  );

  // Run loop: a fixed number of turns per second, rendering after each batch.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * speed;
      last = now;
      const n = Math.min(5, Math.floor(acc));
      if (n > 0) {
        acc -= n;
        stepN(n);
      }
      if (sim.current.stability.finished) {
        setRunning(false);
        setTab('report');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, stepN]);

  const reset = (cfg: SimConfig, s: string) => {
    setRunning(false);
    sim.current = createSimulation(cfg, s);
    setSelHex(-1);
    setSelCloud(-1);
    setObserver(-1);
    setMessage('');
    bump();
  };

  const index = useMemo(() => indexClouds(state), [state, version]);
  const lens: Lens = useMemo(() => {
    if (observer < 0 || !state.clouds[observer]) return { observer: -1, explored: null, visible: null };
    return { observer, explored: state.clouds[observer].explored, visible: visibleCells(state, observer, index) };
  }, [observer, state, index]);

  const onSelect = (idx: number) => {
    setSelHex(idx);
    if (mode === 'clouds' && isVisibleNow(lens, idx)) {
      const d = dominantCloud(state.cells[idx]);
      if (d >= 0) setSelCloud(d);
    }
    if (tab !== 'cloud') setTab('hex');
  };
  const selectCloud = (id: number) => {
    setSelCloud(id);
    setTab('cloud');
  };
  const selectHex = (idx: number) => {
    setSelHex(idx);
    setTab('hex');
  };

  const save = () => downloadText(`ccs-${state.seed}-t${state.turn}.json`, serializeState(state));
  const load = async (f: File) => {
    try {
      const loaded = deserializeState(await f.text());
      setRunning(false);
      sim.current = loaded;
      setConfig(loaded.config);
      setSeed(loaded.seed);
      setSelHex(-1);
      setSelCloud(-1);
      setObserver(-1);
      setMessage(`Загружено: seed ${loaded.seed}, ход ${loaded.turn}`);
      bump();
    } catch (e) {
      setMessage(`Ошибка загрузки: ${(e as Error).message}`);
    }
  };

  const last = state.history[state.history.length - 1];
  const legend = legendFor(state, mode);
  const observable = state.clouds.filter((c) => c.alive && c.cls !== 'small');

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">Civilization Clouds Simulator</strong>
        <div className="group">
          <label className="seed">seed <input value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
          <button onClick={() => { const s = randomSeed(); setSeed(s); reset(config, s); }} title="Новая карта со случайным seed">🎲</button>
          <button onClick={() => reset(config, seed)}>Новая карта</button>
        </div>
        <div className="group">
          {running ? <button onClick={() => setRunning(false)}>❚❚ Пауза</button> : <button className="primary" onClick={() => setRunning(true)} disabled={state.stability.finished}>▶ Запуск</button>}
          <button onClick={() => stepN(1)} disabled={running || state.stability.finished}>Следующий ход</button>
          <button onClick={() => stepN(10)} disabled={running || state.stability.finished}>+10</button>
          <button onClick={() => stepN(50)} disabled={running || state.stability.finished}>+50</button>
          <button onClick={() => reset(state.config, state.seed)} title="Начать заново с тем же seed и параметрами">Сброс</button>
          <label className="speed" title="Скорость, ходов в секунду">скорость <input type="range" min={1} max={30} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /> {speed}/с</label>
        </div>
        <div className="group">
          <button onClick={save}>Сохранить</button>
          <button onClick={() => fileRef.current?.click()}>Загрузить</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { if (e.target.files?.[0]) load(e.target.files[0]); e.target.value = ''; }} />
        </div>
        <div className="status">
          <span>Ход <b>{state.turn}</b> / {state.config.sim.maxTurns}</span>
          <span>Население <b>{num(last?.totalPop ?? 0)}</b></span>
          <span>Поселения <b>{last ? `${last.villages}/${last.towns}/${last.cities}` : '0/0/0'}</b></span>
          <span>Государства <b>{last?.states ?? 0}</b></span>
          {state.stability.finished && <span className="banner">{state.stability.reason}</span>}
          {message && <span className="muted">{message}</span>}
        </div>
      </header>
      <main className="main">
        <section className="map-panel">
          <div className="map-controls">
            <div className="modes" role="tablist" aria-label="Режим карты">
              {MAP_MODES.map((m) => (
                <button key={m.id} className={m.id === mode ? 'on' : ''} onClick={() => setMode(m.id)} role="tab" aria-selected={m.id === mode}>{m.name}</button>
              ))}
            </div>
            <label className="observer">
              Наблюдатель
              <select value={observer} onChange={(e) => setObserver(Number(e.target.value))}>
                <option value={-1}>Глобальный</option>
                {observable.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.cls === 'large' ? 'большое' : 'среднее'})</option>)}
              </select>
            </label>
          </div>
          <MapView
            state={state}
            version={version}
            mode={mode}
            lens={lens}
            selectedHex={selHex}
            selectedCloud={selCloud}
            onHover={(idx, x, y) => setHover(idx >= 0 ? { idx, x, y } : null)}
            onSelect={onSelect}
          />
          <div className="legend map-legend">
            <span className="legend-title">{legend.title}</span>
            {legend.gradient && (
              <span className="gradient">
                <span>{legend.gradient.from}</span>
                <i style={{ background: `linear-gradient(90deg, ${legend.gradient.colors.join(',')})` }} />
                <span>{legend.gradient.to}</span>
              </span>
            )}
            {legend.items.map((it, k) => (
              <span key={k}><i className={it.pattern ?? ''} style={{ background: it.color }} />{it.label}</span>
            ))}
          </div>
          {hover && <HoverTip state={state} lens={lens} idx={hover.idx} x={hover.x} y={hover.y} />}
        </section>
        <aside className="side">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)} role="tab" aria-selected={t.id === tab}>{t.name}</button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === 'hex' && <HexCard state={state} idx={selHex} lens={lens} onSelectCloud={selectCloud} />}
            {tab === 'cloud' && <CloudCard state={state} id={selCloud} lens={lens} index={index} onSelectCloud={selectCloud} />}
            {tab === 'clouds' && <CloudList state={state} lens={lens} index={index} selected={selCloud} onSelectCloud={selectCloud} />}
            {tab === 'events' && <EventLog state={state} version={version} lens={lens} onSelectHex={selectHex} onSelectCloud={selectCloud} />}
            {tab === 'decisions' && <DecisionLog state={state} version={version} lens={lens} onSelectHex={selectHex} onSelectCloud={selectCloud} />}
            {tab === 'stats' && <StatsPanel state={state} version={version} selectedCloud={selCloud} observer={observer} />}
            {tab === 'report' && <Report state={state} index={index} />}
            {tab === 'config' && <ConfigEditor config={config} onApply={(cfg) => { setConfig(cfg); reset(cfg, seed); setTab('hex'); }} />}
            {tab === 'batch' && <BatchPanel config={config} />}
          </div>
        </aside>
      </main>
    </div>
  );
}

function HoverTip({ state, lens, idx, x, y }: { state: SimState; lens: Lens; idx: number; x: number; y: number }) {
  const hex = state.map.hexes[idx];
  const known = isKnown(lens, idx);
  const visible = isVisibleNow(lens, idx);
  const cell = state.cells[idx];
  const N = cellTotal(cell);
  const s = cell.settlement >= 0 ? state.settlements[cell.settlement] : null;
  const groups = visible ? [...cell.groups].sort((a, b) => b.rural + b.urban - (a.rural + a.urban)).slice(0, 4) : [];
  return (
    <div className="hover-tip" style={{ left: x + 14, top: y + 14 }}>
      <div className="tip-title">({hex.col}, {hex.row}) · {known ? state.config.map.terrains[hex.terrain].name : 'не разведано'}</div>
      {known && visible && N > 0 && <div>Население {num(N)}</div>}
      {groups.map((g, k) => (
        <div key={k} className="tip-row">
          <i style={{ background: cloudColor(state, g.cloud) }} />
          <span>{state.clouds[g.cloud].name}</span>
          <b>{num(g.rural + g.urban)}</b>
        </div>
      ))}
      {known && s && s.alive && <div>{s.name} — {levelName(s.level)}</div>}
    </div>
  );
}
