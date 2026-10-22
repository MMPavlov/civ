import { useState } from 'react';
import { STRATEGY_NAMES } from '../sim/ai';
import { cloudRegions, groupStats } from '../sim/cohesion';
import type { CloudIndex } from '../sim/pop';
import { getRelation, other, relationsOf } from '../sim/relations';
import type { SimState } from '../sim/types';
import { cloudColor, cultureColor } from './colors';
import { CLASS_NAMES, num, pct, STATUS_NAMES } from './labels';
import type { Lens } from './mapModes';

/** Whether the observer may see information about cloud `id`. */
export function knowsCloud(state: SimState, lens: Lens, id: number): boolean {
  if (lens.observer < 0 || lens.observer === id) return true;
  if (getRelation(state, lens.observer, id)) return true;
  if (!lens.visible) return false;
  for (const idx of lens.visible) if (state.cells[idx].groups.some((g) => g.cloud === id)) return true;
  return false;
}

interface Props {
  state: SimState;
  id: number;
  lens: Lens;
  index: CloudIndex;
  onSelectCloud: (id: number) => void;
}

export function CloudCard({ state, id, lens, index, onSelectCloud }: Props) {
  if (id < 0 || !state.clouds[id]) return <p className="muted">Выберите облако в списке или на карте.</p>;
  const c = state.clouds[id];
  const race = state.races[c.race];
  const head = (
    <h3>
      <i className="sw big" style={{ background: cloudColor(state, id) }} />
      {c.name} {!c.alive && <span className="badge">{c.absorbedInto >= 0 ? `в составе ${state.clouds[c.absorbedInto].name}` : 'исчезло'}</span>}
    </h3>
  );
  if (!knowsCloud(state, lens, id)) {
    return <div className="card">{head}<p className="muted">У выбранного наблюдателя нет сведений об этом облаке.</p></div>;
  }
  const full = lens.observer < 0 || lens.observer === id;
  const ch = state.config.clouds.characters[c.character];
  if (!full) {
    let seen = 0;
    index.cells[id]?.forEach((idx, j) => {
      if (lens.visible?.has(idx)) seen += index.cellPop[id][j];
    });
    const rel = getRelation(state, lens.observer, id);
    return (
      <div className="card">
        {head}
        <dl className="kv">
          <dt>Раса</dt><dd>{race.name}</dd>
          <dt>Класс</dt><dd>{CLASS_NAMES[c.cls]}</dd>
          <dt>Видимое население</dt><dd>{num(seen)}</dd>
          <dt>Отношения с наблюдателем</dt><dd>{rel ? `${STATUS_NAMES[rel.status]}, ${num(rel.attitude)}` : 'нет контакта'}</dd>
        </dl>
        <p className="muted small">Режим наблюдения за облаком: внутренние сведения чужих облаков скрыты.</p>
      </div>
    );
  }
  const stats = c.alive ? groupStats(state, c, index) : [];
  const regions = c.alive ? cloudRegions(state, id, index) : [];
  const settlements = state.settlements.filter((s) => s.alive && s.cloud === id);
  const pol = c.polity >= 0 ? state.polities[c.polity] : null;
  const rels = relationsOf(state, id).sort((a, b) => b.attitude - a.attitude);
  return (
    <div className="card">
      {head}
      <dl className="kv">
        <dt>Раса</dt><dd>{race.name} (рост ×{race.growth}, миграция ×{race.migration}, ёмкость {race.cultureCapacity})</dd>
        <dt>Класс облака</dt><dd>{CLASS_NAMES[c.cls]}{c.maxArea > 0 ? `, предельный ареал ${c.maxArea} гекс.` : ''}</dd>
        <dt>Характер ИИ</dt><dd>{ch.name}</dd>
        <dt>Население</dt><dd>{num(index.pop[id] ?? 0)} (городское {num(index.urban[id] ?? 0)})</dd>
        <dt>Занятые гексы</dt><dd>{index.cells[id]?.length ?? 0}{regions.length > 1 ? `, регионов: ${regions.length}` : ''}</dd>
        <dt>Культурная нагрузка / ёмкость</dt><dd>{num(c.load, 2)} / {num(c.capacity, 2)}</dd>
        <dt>Сплочённость</dt><dd>{num(c.cohesion, 2)}</dd>
        {c.cls !== 'large' && <><dt>Обособленность</dt><dd>{num(c.isolation)}</dd></>}
        <dt>Институты</dt><dd>{num(c.institutions, 2)}</dd>
        <dt>Поселения</dt><dd>{settlements.length} (деревень {settlements.filter((s) => s.level === 1).length}, городков {settlements.filter((s) => s.level === 2).length}, городов {settlements.filter((s) => s.level === 3).length})</dd>
        <dt>Государство</dt><dd>{pol ? `${pol.name} (с хода ${pol.foundedTurn})` : c.stateStreak > 0 ? `формируется: ${c.stateStreak} ход(ов) условий` : 'нет'}</dd>
        {c.parent >= 0 && <><dt>Отделилось от</dt><dd><button className="link" onClick={() => onSelectCloud(c.parent)}>{state.clouds[c.parent].name}</button> на ходу {c.bornTurn}</dd></>}
      </dl>
      <h4>Текущая стратегия: {STRATEGY_NAMES[c.strategy]}</h4>
      <Reasons reasons={c.strategyReasons} />
      {stats.length > 0 && (
        <>
          <h4>Культурный состав</h4>
          <table className="data">
            <thead><tr><th>Культура</th><th>Доля</th><th>Дист.</th><th>Обос.</th><th>Спл.</th><th>Гибр.</th><th>Раскол</th></tr></thead>
            <tbody>
              {stats.map((g, k) => (
                <tr key={k}>
                  <td title={`${state.races[g.group.race].name}; происхождение: ${g.group.origin}`}>
                    <i className="sw" style={{ background: cultureColor(state, g.group.culture) }} />
                    {state.cultures[g.group.culture].name}{g.group.culture === c.culture ? ' ★' : ''}
                  </td>
                  <td>{pct(g.share)}</td>
                  <td>{num(g.distance, 2)}</td>
                  <td>{num(g.group.isolation)}</td>
                  <td>{num(g.group.cohesion, 2)}</td>
                  <td>{g.group.culture === c.culture ? '—' : pct(g.group.hybridProgress)}</td>
                  <td>{g.group.culture === c.culture ? '—' : num(g.group.schismRisk, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">★ основная культура. Дист. — культурная дистанция от неё; Обос. — обособленность; Гибр. — прогресс гибридизации; Раскол — накопленный риск (порог {state.config.culture.schismThreshold}).</p>
        </>
      )}
      <h4>Отношения с известными соседями</h4>
      {rels.length === 0 ? (
        <p className="muted">Контактов нет.</p>
      ) : (
        <table className="data">
          <thead><tr><th>Облако</th><th>Статус</th><th>Отношение</th><th>С хода</th></tr></thead>
          <tbody>
            {rels.map((r) => {
              const o = other(r, id);
              return (
                <tr key={o}>
                  <td><button className="link" onClick={() => onSelectCloud(o)}><i className="sw" style={{ background: cloudColor(state, o) }} />{state.clouds[o].name}</button></td>
                  <td>{STATUS_NAMES[r.status]}{r.patron >= 0 ? (r.patron === id ? ' (покровитель)' : ' (подопечный)') : ''}{r.integration ? ` · интеграция ${pct(r.integration.progress)}` : ''}</td>
                  <td>{num(r.attitude)}</td>
                  <td>{r.contactTurn}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {c.polity < 0 && c.stateReasons.length > 0 && (
        <>
          <h4>Условия государственности</h4>
          <Reasons reasons={c.stateReasons} />
        </>
      )}
    </div>
  );
}

export function Reasons({ reasons }: { reasons: Array<{ label: string; value: number }> }) {
  if (!reasons.length) return null;
  const max = Math.max(...reasons.map((r) => Math.abs(r.value)), 1e-6);
  return (
    <ul className="reasons">
      {reasons.map((r, k) => (
        <li key={k}>
          <span className="r-label">{r.label}</span>
          <span className="r-bar"><i className={r.value < 0 ? 'neg' : 'pos'} style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }} /></span>
          <span className="r-val">{num(r.value, Math.abs(r.value) >= 100 ? 0 : 2)}</span>
        </li>
      ))}
    </ul>
  );
}

interface ListProps {
  state: SimState;
  lens: Lens;
  index: CloudIndex;
  selected: number;
  onSelectCloud: (id: number) => void;
}

export function CloudList({ state, lens, index, selected, onSelectCloud }: ListProps) {
  const [showDead, setShowDead] = useState(false);
  const rows = state.clouds
    .filter((c) => (showDead || c.alive) && knowsCloud(state, lens, c.id))
    .sort((a, b) => Number(b.alive) - Number(a.alive) || (index.pop[b.id] ?? 0) - (index.pop[a.id] ?? 0));
  return (
    <div className="card">
      <label className="check"><input type="checkbox" checked={showDead} onChange={(e) => setShowDead(e.target.checked)} /> показывать исчезнувшие и интегрированные</label>
      <table className="data clickable">
        <thead><tr><th>Облако</th><th>Класс</th><th>Население</th><th>Гексы</th><th>Спл.</th><th>Гос.</th></tr></thead>
        <tbody>
          {rows.map((c) => {
            const full = lens.observer < 0 || lens.observer === c.id;
            return (
              <tr key={c.id} className={c.id === selected ? 'sel' : ''} onClick={() => onSelectCloud(c.id)}>
                <td><i className="sw" style={{ background: cloudColor(state, c.id) }} />{c.name}{!c.alive ? ' †' : ''}</td>
                <td>{CLASS_NAMES[c.cls]}</td>
                <td>{full ? num(index.pop[c.id] ?? 0) : '?'}</td>
                <td>{full ? index.cells[c.id]?.length ?? 0 : '?'}</td>
                <td>{full ? num(c.cohesion, 2) : '?'}</td>
                <td>{c.polity >= 0 ? '●' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

