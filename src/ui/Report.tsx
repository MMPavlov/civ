import { summarize } from '../sim/batch';
import type { SimState } from '../sim/types';
import { cloudColor, polityColor } from './colors';
import { downloadText } from './download';
import { CLASS_NAMES, num, pct } from './labels';
import type { CloudIndex } from '../sim/pop';

const TREATY_KINDS: Record<string, string> = { border: 'граница', exchange: 'обмен', neutral: 'нейтральная полоса', shared: 'совместное использование' };

export function Report({ state, index }: { state: SimState; index: CloudIndex }) {
  const r = summarize(state);
  const polities = state.polities;
  const top = state.clouds.filter((c) => c.alive && c.cls !== 'small').sort((a, b) => (index.pop[b.id] ?? 0) - (index.pop[a.id] ?? 0)).slice(0, 12);
  return (
    <div className="card">
      <h3>Отчёт о состоянии на ходу {state.turn}</h3>
      <p className={state.stability.finished ? 'banner' : 'muted'}>
        {state.stability.finished ? state.stability.reason : `Симуляция продолжается. Устойчивых ходов подряд: ${state.stability.stableTurns} из ${state.config.sim.stabilityWindow}.`}
      </p>
      <button onClick={() => downloadText(`ccs-report-${state.seed}-t${state.turn}.json`, JSON.stringify({ summary: r, polities, treaties: state.treaties, counters: state.counters }, null, 2))}>
        Скачать отчёт (JSON)
      </button>
      <dl className="kv">
        <dt>Seed</dt><dd>{state.seed}</dd>
        <dt>Население</dt><dd>{num(r.totalPop)} (городское {pct(r.urbanShare, 1)})</dd>
        <dt>Облака (больш./средн./мал.)</dt><dd>{r.largeClouds} / {r.mediumClouds} / {r.smallClouds}</dd>
        <dt>Интеграций / расколов / гибридных культур</dt><dd>{r.integrations} / {r.schisms} / {r.hybrids}</dd>
        <dt>Интегрировано малых народов</dt><dd>{pct(r.integratedSmallShare)}</dd>
        <dt>Деревень / городков / городов</dt><dd>{r.villages} / {r.towns} / {r.cities}</dd>
        <dt>Среднее население города</dt><dd>{num(r.avgCityPop)}</dd>
        <dt>Государств (образовано / существует)</dt><dd>{r.statesFormed} / {r.statesAlive}</dd>
        <dt>Договоров о границах (всего / действует)</dt><dd>{r.treaties} / {r.treatiesAlive}</dd>
        <dt>Конфликтов</dt><dd>{r.wars}</dd>
        <dt>Потери от голода / войн</dt><dd>{num(state.counters.famineDeaths)} / {num(state.counters.warDeaths)}</dd>
      </dl>
      <h4>Государства</h4>
      {polities.length === 0 ? <p className="muted">Государств пока нет.</p> : (
        <table className="data">
          <thead><tr><th>Государство</th><th>Облако</th><th>Столица</th><th>С хода</th><th>Гексов</th></tr></thead>
          <tbody>
            {polities.map((p) => (
              <tr key={p.id} className={p.alive ? '' : 'dead'}>
                <td><i className="sw" style={{ background: polityColor(state, p.id) }} />{p.name}{p.alive ? '' : ` (распалось на ходу ${p.endedTurn})`}</td>
                <td>{state.clouds[p.cloud].name}</td>
                <td>{state.settlements[p.capital]?.name}</td>
                <td>{p.foundedTurn}</td>
                <td>{state.politics.control.filter((c) => c === p.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4>Договоры о границах</h4>
      {state.treaties.length === 0 ? <p className="muted">Договоров нет.</p> : (
        <table className="data">
          <thead><tr><th>Стороны</th><th>Ход</th><th>Содержание</th><th>Гексов</th><th>Статус</th></tr></thead>
          <tbody>
            {state.treaties.slice(-30).map((t) => (
              <tr key={t.id} className={t.alive ? '' : 'dead'}>
                <td>{state.polities[t.a].name} — {state.polities[t.b].name}</td>
                <td>{t.turn}</td>
                <td>{t.kinds.map((k) => TREATY_KINDS[k]).join(', ')}</td>
                <td>{t.cells.length}</td>
                <td>{t.alive ? 'действует' : `пересмотрен (${t.endReason})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4>Крупнейшие облака</h4>
      <table className="data">
        <thead><tr><th>Облако</th><th>Класс</th><th>Население</th><th>Гексы</th><th>Культур</th><th>Сплоч.</th></tr></thead>
        <tbody>
          {top.map((c) => (
            <tr key={c.id}>
              <td><i className="sw" style={{ background: cloudColor(state, c.id) }} />{c.name}</td>
              <td>{CLASS_NAMES[c.cls]}</td>
              <td>{num(index.pop[c.id] ?? 0)}</td>
              <td>{index.cells[c.id]?.length ?? 0}</td>
              <td>{c.groups.length}</td>
              <td>{num(c.cohesion, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
