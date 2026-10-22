import { useMemo } from 'react';
import type { SimState } from '../sim/types';
import { CATEGORICAL, cloudColor, largeSlot, OTHER_GRAY } from './colors';
import { LineChart, type Series } from './LineChart';

interface Props {
  state: SimState;
  version: number;
  selectedCloud: number;
  observer: number;
}

/**
 * Time-series charts. Per-cloud charts show the large clouds (categorical
 * slots in fixed order), the selected cloud if it is not large, and an
 * aggregated "other clouds" line — never more than eight series.
 */
export function StatsPanel({ state, version, selectedCloud, observer }: Props) {
  const charts = useMemo(() => {
    const h = state.history;
    const x = h.map((s) => s.turn);
    const shown = new Set<number>();
    const ids: number[] = [];
    if (observer >= 0) ids.push(observer);
    else {
      for (const c of state.clouds) if (c.cls === 'large' && largeSlot(state, c.id) < 7) ids.push(c.id);
      if (selectedCloud >= 0 && !ids.includes(selectedCloud)) ids.push(selectedCloud);
    }
    ids.forEach((id) => shown.add(id));
    const perCloud = (key: 'pop' | 'area' | 'cohesion' | 'load', other: 'sum' | 'mean' | null): Series[] => {
      const series: Series[] = ids.map((id) => ({
        id: String(id),
        name: state.clouds[id].name,
        color: cloudColor(state, id),
        values: h.map((s) => {
          const c = s.clouds.find((v) => v.id === id);
          return c ? c[key] : null;
        }),
      }));
      if (other && observer < 0) {
        series.push({
          id: 'other',
          name: other === 'sum' ? 'Остальные (сумма)' : 'Остальные (в среднем)',
          color: OTHER_GRAY,
          values: h.map((s) => {
            const rest = s.clouds.filter((c) => !shown.has(c.id));
            if (!rest.length) return null;
            const sum = rest.reduce((a, c) => a + c[key], 0);
            return other === 'sum' ? sum : sum / rest.length;
          }),
        });
      }
      return series;
    };
    const global = (keys: Array<{ k: keyof SimState['history'][number]; name: string }>): Series[] =>
      keys.map(({ k, name }, i) => ({ id: String(k), name, color: CATEGORICAL[i], values: h.map((s) => s[k] as number) }));
    return {
      x,
      pop: perCloud('pop', 'mean'),
      area: perCloud('area', 'mean'),
      cohesion: perCloud('cohesion', 'mean'),
      load: perCloud('load', 'mean'),
      settlements: global([
        { k: 'villages', name: 'Деревни' },
        { k: 'towns', name: 'Городки' },
        { k: 'cities', name: 'Города' },
      ]),
      states: global([{ k: 'states', name: 'Государства' }]),
      disputes: global([{ k: 'disputes', name: 'Спорные гексы' }]),
      delimited: global([{ k: 'delimitedShare', name: 'Доля разграниченной территории' }]),
      urban: [{ id: 'u', name: 'Доля городского населения', color: CATEGORICAL[0], values: h.map((s) => (s.totalPop > 0 ? s.urbanPop / s.totalPop : 0)) }],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, version, selectedCloud, observer]);

  if (charts.x.length < 2) return <p className="muted">Статистика появится после первых ходов.</p>;
  const p = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="charts">
      <LineChart title="Население по облакам" x={charts.x} series={charts.pop} />
      <LineChart title="Площадь ареалов, гексов" x={charts.x} series={charts.area} />
      <LineChart title="Сплочённость" x={charts.x} series={charts.cohesion} yMax={1} format={(v) => v.toFixed(2)} />
      <LineChart title="Культурная нагрузка" x={charts.x} series={charts.load} format={(v) => v.toFixed(1)} />
      {observer < 0 && (
        <>
          <LineChart title="Число поселений" x={charts.x} series={charts.settlements} />
          <LineChart title="Количество государств" x={charts.x} series={charts.states} />
          <LineChart title="Спорные гексы (территориальные споры)" x={charts.x} series={charts.disputes} />
          <LineChart title="Доля политически разграниченной территории" x={charts.x} series={charts.delimited} yMax={1} format={p} />
          <LineChart title="Доля городского населения" x={charts.x} series={charts.urban} format={p} />
        </>
      )}
    </div>
  );
}
