import { effectiveCapacity } from '../sim/demography';
import { cellRural, cellTotal, cellUrban } from '../sim/pop';
import { levelName } from '../sim/settlements';
import { NEUTRAL, SHARED, type SimState } from '../sim/types';
import { cloudColor, cultureColor, polityColor } from './colors';
import { num, pct } from './labels';
import { isKnown, isVisibleNow, type Lens } from './mapModes';

interface Props {
  state: SimState;
  idx: number;
  lens: Lens;
  onSelectCloud: (id: number) => void;
}

export function HexCard({ state, idx, lens, onSelectCloud }: Props) {
  if (idx < 0) return <p className="muted">Выберите гекс на карте.</p>;
  const hex = state.map.hexes[idx];
  const terrain = state.config.map.terrains[hex.terrain];
  const title = (
    <h3>
      Гекс ({hex.col}, {hex.row}) <span className="muted small">axial q={hex.q}, r={hex.r}</span>
    </h3>
  );
  if (!isKnown(lens, idx)) {
    return (
      <div className="card">
        {title}
        <p className="muted">Территория не разведана выбранным облаком.</p>
      </div>
    );
  }
  const cell = state.cells[idx];
  const visible = isVisibleNow(lens, idx);
  const N = cellTotal(cell);
  const f = cell.food;
  const s = cell.settlement >= 0 ? state.settlements[cell.settlement] : null;
  const zone = cell.zone >= 0 ? state.settlements[cell.zone] : null;
  const p = state.politics;
  const rec = p.recognized[idx];
  const recText = rec >= 0 ? state.polities[rec]?.name : rec === NEUTRAL ? 'нейтральная территория' : rec === SHARED ? 'совместное использование' : 'не определена';

  return (
    <div className="card">
      {title}
      <dl className="kv">
        <dt>Местность</dt><dd>{terrain.name}{hex.river > 0 ? `, река (сток ${hex.river})` : ''}{hex.coastal ? ', берег' : ''}</dd>
        <dt>Вместимость</dt><dd>{num(hex.capacity)}{s ? ` (+ рабочие места поселения → ${num(effectiveCapacity(state, idx))})` : ''}</dd>
        <dt>Плодородие</dt><dd>{num(hex.fertility, 2)}</dd>
        <dt>Пресная вода</dt><dd>{num(hex.freshWater, 2)}</dd>
        <dt>С/х потенциал</dt><dd>{num(hex.agriPotential)}</dd>
        <dt>Стоимость перемещения</dt><dd>{Number.isFinite(hex.moveCost) ? num(hex.moveCost, 2) : 'непроходимо'}</dd>
        <dt>Оборона / привлекательность</dt><dd>{num(hex.defense, 2)} / {num(hex.appeal, 2)}</dd>
      </dl>
      {!visible ? (
        <p className="muted">Сейчас вне поля зрения: сведения о населении недоступны.</p>
      ) : (
        <>
          <h4>Продовольствие</h4>
          <dl className="kv">
            <dt>Произведено / потребность</dt><dd>{num(f.produced, 1)} / {num(f.need, 1)}</dd>
            <dt>Баланс</dt><dd>{num(f.surplus, 1)}</dd>
            <dt>Импорт / экспорт</dt><dd>{num(f.imported, 1)} / {num(f.exported, 1)}</dd>
            <dt>Из запасов / запас</dt><dd>{num(f.fromStock, 1)} / {num(cell.stock, 1)}</dd>
            <dt>Обеспеченность</dt><dd>{pct(f.ratio)}</dd>
          </dl>
          <h4>Население: {num(N)} (сельское {num(cellRural(cell))}, городское {num(cellUrban(cell))})</h4>
          {cell.groups.length === 0 ? (
            <p className="muted">Не заселено.</p>
          ) : (
            <table className="data">
              <thead>
                <tr><th>Облако</th><th>Культура</th><th>Раса</th><th>Сел.</th><th>Гор.</th><th>Доля</th></tr>
              </thead>
              <tbody>
                {cell.groups.map((g, k) => (
                  <tr key={k}>
                    <td><button className="link" onClick={() => onSelectCloud(g.cloud)}><i className="sw" style={{ background: cloudColor(state, g.cloud) }} />{state.clouds[g.cloud].name}</button></td>
                    <td><i className="sw" style={{ background: cultureColor(state, g.culture) }} />{state.cultures[g.culture].name}</td>
                    <td>{state.races[g.race].name}</td>
                    <td>{num(g.rural)}</td>
                    <td>{num(g.urban)}</td>
                    <td>{pct((g.rural + g.urban) / N)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <h4>Поселение и обслуживание</h4>
      {s && s.alive ? (
        <dl className="kv">
          <dt>Поселение</dt><dd>{s.name} — {levelName(s.level)} (основано на ходу {s.foundedTurn})</dd>
          <dt>Владелец</dt><dd>{state.clouds[s.cloud].name}</dd>
          <dt>Рабочие места / горожане</dt><dd>{num(s.jobs)} / {num(cellUrban(cell))}</dd>
          <dt>Обслуживаемое сельское население</dt><dd>{num(s.servedPop)}</dd>
          <dt>Среднее снабжение</dt><dd>{pct(s.supplyAvg)}</dd>
          {s.level < 3 && <><dt>Спрос на услуги следующего уровня</dt><dd>{num(s.potentialJobs)}</dd></>}
          {s.blockers.length > 0 && <><dt>Препятствия росту</dt><dd>{s.blockers.join('; ')}</dd></>}
          {s.level < 3 && s.blockers.length === 0 && <><dt>Рост</dt><dd>условия выполняются {s.upStreak} ход(ов) подряд</dd></>}
        </dl>
      ) : (
        <p className="muted">Поселения нет.</p>
      )}
      <p>Зона обслуживания: {zone && zone.alive ? `${zone.name} (${levelName(zone.level)})` : 'вне зон'}</p>
      <h4>Политика</h4>
      {p.claims[idx].length === 0 ? (
        <p className="muted">Претензий нет.</p>
      ) : (
        <ul className="plain">
          {p.claims[idx].map((c) => (
            <li key={c.p}><i className="sw" style={{ background: polityColor(state, c.p) }} />{state.polities[c.p].name}: сила претензии {num(c.s, 2)}</li>
          ))}
        </ul>
      )}
      <dl className="kv">
        <dt>Фактическое управление</dt><dd>{p.control[idx] >= 0 ? state.polities[p.control[idx]].name : 'нет'}</dd>
        <dt>Признанная принадлежность</dt><dd>{recText}</dd>
        <dt>Спор</dt><dd>{p.disputed[idx] ? 'да' : 'нет'}</dd>
      </dl>
    </div>
  );
}
