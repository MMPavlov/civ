import { useMemo, useState } from 'react';
import { cellLabel } from '../sim/log';
import type { DecisionKind, EventType, SimState } from '../sim/types';
import { Reasons, knowsCloud } from './CloudCard';
import { cloudColor } from './colors';
import { DECISION_NAMES, EVENT_NAMES } from './labels';
import type { Lens } from './mapModes';

interface Common {
  state: SimState;
  version: number;
  lens: Lens;
  onSelectHex: (idx: number) => void;
  onSelectCloud: (id: number) => void;
}

const MAX_ROWS = 400;

export function EventLog({ state, version, lens, onSelectHex, onSelectCloud }: Common) {
  const [type, setType] = useState<EventType | ''>('');
  const [query, setQuery] = useState('');
  const [cloud, setCloud] = useState(-1);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = [];
    for (let i = state.events.length - 1; i >= 0 && out.length < MAX_ROWS; i--) {
      const e = state.events[i];
      if (type && e.type !== type) continue;
      if (cloud >= 0 && !e.actors.includes(cloud)) continue;
      if (lens.observer >= 0 && !e.actors.some((a) => a === lens.observer) && !e.actors.every((a) => knowsCloud(state, lens, a))) continue;
      if (q && !`${e.result} ${e.cause}`.toLowerCase().includes(q)) continue;
      out.push(e);
    }
    return out;
    // version: the event array is mutated in place
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, version, type, query, cloud, lens]);
  const types = Object.keys(EVENT_NAMES) as EventType[];
  return (
    <div className="card">
      <div className="filters">
        <select value={type} onChange={(e) => setType(e.target.value as EventType | '')}>
          <option value="">Все события</option>
          {types.map((t) => <option key={t} value={t}>{EVENT_NAMES[t]}</option>)}
        </select>
        <select value={cloud} onChange={(e) => setCloud(Number(e.target.value))}>
          <option value={-1}>Все облака</option>
          {state.clouds.filter((c) => knowsCloud(state, lens, c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input placeholder="поиск" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="muted small">Всего событий: {state.events.length}; показано последних {rows.length}.</p>
      <ol className="events">
        {rows.map((e, k) => (
          <li key={`${e.turn}-${k}`}>
            <div className="ev-head">
              <span className="turn">ход {e.turn}</span>
              <span className={`tag t-${e.type}`}>{EVENT_NAMES[e.type]}</span>
              {e.hex >= 0 && <button className="link" onClick={() => onSelectHex(e.hex)}>{cellLabel(state, e.hex)}</button>}
            </div>
            <div>{e.result}</div>
            <div className="muted small">
              Причина: {e.cause}
              {e.actors.length > 0 && ' · '}
              {e.actors.map((a) => (
                <button key={a} className="link" onClick={() => onSelectCloud(a)}>
                  <i className="sw" style={{ background: cloudColor(state, a) }} />{state.clouds[a]?.name}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DecisionLog({ state, version, lens, onSelectHex, onSelectCloud }: Common) {
  const [kind, setKind] = useState<DecisionKind | ''>('');
  const [cloud, setCloud] = useState(-1);
  const [onlyRefused, setOnlyRefused] = useState(false);
  const effectiveCloud = lens.observer >= 0 ? lens.observer : cloud;
  const rows = useMemo(() => {
    const out = [];
    for (let i = state.decisions.length - 1; i >= 0 && out.length < MAX_ROWS; i--) {
      const d = state.decisions[i];
      if (kind && d.kind !== kind) continue;
      if (effectiveCloud >= 0 && d.cloud !== effectiveCloud) continue;
      if (onlyRefused && d.accepted) continue;
      out.push(d);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, version, kind, effectiveCloud, onlyRefused]);
  const kinds = Object.keys(DECISION_NAMES) as DecisionKind[];
  return (
    <div className="card">
      <div className="filters">
        <select value={kind} onChange={(e) => setKind(e.target.value as DecisionKind | '')}>
          <option value="">Все решения</option>
          {kinds.map((k) => <option key={k} value={k}>{DECISION_NAMES[k]}</option>)}
        </select>
        {lens.observer < 0 && (
          <select value={cloud} onChange={(e) => setCloud(Number(e.target.value))}>
            <option value={-1}>Все облака</option>
            {state.clouds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <label className="check"><input type="checkbox" checked={onlyRefused} onChange={(e) => setOnlyRefused(e.target.checked)} /> только отказы</label>
      </div>
      <p className="muted small">Журнал решений хранит {state.config.sim.maxDecisions} последних записей. Полосы — вклад факторов (синие — за, красные — против).</p>
      <ol className="events">
        {rows.map((d, k) => (
          <li key={`${d.turn}-${k}`} className={d.accepted ? '' : 'refused'}>
            <div className="ev-head">
              <span className="turn">ход {d.turn}</span>
              <span className="tag">{DECISION_NAMES[d.kind]}</span>
              <button className="link" onClick={() => onSelectCloud(d.cloud)}><i className="sw" style={{ background: cloudColor(state, d.cloud) }} />{state.clouds[d.cloud]?.name}</button>
              {d.hex >= 0 && <button className="link" onClick={() => onSelectHex(d.hex)}>{cellLabel(state, d.hex)}</button>}
            </div>
            <div><b>{d.title}</b></div>
            <Reasons reasons={d.reasons} />
          </li>
        ))}
      </ol>
    </div>
  );
}
