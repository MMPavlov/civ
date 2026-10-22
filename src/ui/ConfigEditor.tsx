import { useRef, useState } from 'react';
import { defaultConfig, type SimConfig } from '../sim/config';
import { parseConfig, serializeConfig } from '../sim/serialize';
import { downloadText } from './download';

const SECTION_NAMES: Record<string, string> = {
  map: 'Карта',
  demography: 'Демография',
  food: 'Продовольствие и транспорт',
  clouds: 'Облака, расы, характеры',
  culture: 'Культура и сплочённость',
  interactions: 'Взаимодействия',
  settlements: 'Поселения',
  states: 'Государства и границы',
  sim: 'Управление ходами',
};

const KEY_NAMES: Record<string, string> = {
  width: 'ширина', height: 'высота', landFraction: 'доля суши', climate: 'климат (−1 холод … +1 тепло)',
  humidity: 'влажность (−1 … +1)', mountainousness: 'гористость', rivers: 'число рек', fertility: 'плодородие',
  tundra: 'тундра', snow: 'снега', lakes: 'малые озёра', terrains: 'типы местности', capacity: 'вместимость',
  permeability: 'проницаемость', agri: 'урожайность', defense: 'оборона', habitable: 'обитаемо', color: 'цвет', name: 'название',
  baseGrowth: 'базовый темп роста', foodPerCapita: 'потребление пищи на чел.', famineMortality: 'смертность от голода',
  migrationRate: 'интенсивность миграции', crowdingStart: 'порог тесноты', faminePush: 'голодная миграция',
  expansionDrive: 'тяга к экспансии', minGroup: 'мин. группа', stayBias: 'склонность оставаться', softmaxTemperature: 'температура выбора',
  yieldFactor: 'множитель урожая', laborScale: 'масштаб труда L0/K', transportLambda: 'λ транспорта', transportRadius: 'радиус транспорта',
  riverCostFactor: 'удешевление по реке', stockPerCapita: 'запас на чел.', spoilage: 'порча запасов', allocationRounds: 'раундов распределения',
  flow: 'обмен пищей по отношениям', counts: 'число облаков', classes: 'классы облаков', races: 'расы', characters: 'характеры ИИ',
  sightRadius: 'радиус обзора', growth: 'рост', migration: 'миграция', cultureCapacity: 'культурная ёмкость', cohesion: 'сплочённость',
  affinity: 'приспособленность к местности', weights: 'веса', riskAversion: 'неприятие риска', isolation: 'обособленность',
  loadScale: 'масштаб нагрузки', hybridRate: 'скорость гибридизации', schismThreshold: 'порог раскола',
  upkeep: 'содержание (дер., гор-к, город)', tiers: 'уровни услуг', village: 'деревня', town: 'городок', city: 'город',
  upgradeTurns: 'ходов для роста', declineTurns: 'ходов для упадка', minPopulation: 'мин. население', formationTurns: 'ходов формирования',
  claimWeights: 'веса претензий', claimThreshold: 'порог претензии', treatyMinDuration: 'мин. срок договора',
  maxTurns: 'максимум ходов', stabilityWindow: 'окно устойчивости', decisionInterval: 'интервал стратегий',
  maxMajorActionsPerTurn: 'крупных действий за ход',
};

interface Props {
  config: SimConfig;
  onApply: (cfg: SimConfig) => void;
}

/** Editable experiment configuration. Changes take effect on the next new map. */
export function ConfigEditor({ config, onApply }: Props) {
  const [draft, setDraft] = useState<SimConfig>(() => structuredClone(config));
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ map: true });
  const file = useRef<HTMLInputElement>(null);

  const update = (path: string[], value: unknown) => {
    setDraft((d) => {
      const copy = structuredClone(d) as unknown as Record<string, unknown>;
      let obj = copy as Record<string, unknown>;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]] as Record<string, unknown>;
      obj[path[path.length - 1]] = value;
      return copy as unknown as SimConfig;
    });
  };

  const onLoad = async (f: File) => {
    try {
      setDraft(parseConfig(await f.text()));
      setError('');
    } catch (e) {
      setError(`Не удалось прочитать конфигурацию: ${(e as Error).message}`);
    }
  };

  return (
    <div className="card config">
      <div className="filters">
        <button className="primary" onClick={() => onApply(draft)}>Применить и создать карту</button>
        <button onClick={() => setDraft(defaultConfig())}>По умолчанию</button>
        <button onClick={() => downloadText('ccs-config.json', serializeConfig(draft))}>Сохранить</button>
        <button onClick={() => file.current?.click()}>Загрузить</button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && onLoad(e.target.files[0])} />
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Параметры применяются к новой карте с текущим seed. Все коэффициенты модели вынесены сюда.</p>
      {(Object.keys(draft) as Array<keyof SimConfig>).map((section) => (
        <details key={section} open={!!open[section]} onToggle={(e) => setOpen((o) => ({ ...o, [section]: (e.target as HTMLDetailsElement).open }))}>
          <summary>{SECTION_NAMES[section] ?? section}</summary>
          <Field value={draft[section]} path={[section]} onChange={update} depth={0} />
        </details>
      ))}
    </div>
  );
}

function Field({ value, path, onChange, depth }: { value: unknown; path: string[]; onChange: (p: string[], v: unknown) => void; depth: number }) {
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return (
      <div className="arr">
        {value.map((v, i) => (
          <input key={i} type="number" step="any" value={v as number} onChange={(e) => {
            const next = [...value];
            next[i] = Number(e.target.value);
            onChange(path, next);
          }} />
        ))}
      </div>
    );
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return <input className="wide" value={(value as string[]).join(', ')} onChange={(e) => onChange(path, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />;
  }
  if (value && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
    return (
      <div className={`fields depth-${depth}`}>
        {entries.map(([k, v]) => {
          const label = Array.isArray(value) ? labelForItem(v, k) : KEY_NAMES[k] ?? k;
          const leaf = v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => typeof x !== 'object'));
          return leaf ? (
            <label key={k} className="field" title={[...path, k].join('.')}>
              <span>{label}</span>
              <Field value={v} path={[...path, k]} onChange={onChange} depth={depth + 1} />
            </label>
          ) : (
            <details key={k} className="sub">
              <summary title={[...path, k].join('.')}>{label}</summary>
              <Field value={v} path={[...path, k]} onChange={onChange} depth={depth + 1} />
            </details>
          );
        })}
      </div>
    );
  }
  if (typeof value === 'boolean') return <input type="checkbox" checked={value} onChange={(e) => onChange(path, e.target.checked)} />;
  if (typeof value === 'number') return <input type="number" step="any" value={value} onChange={(e) => onChange(path, Number(e.target.value))} />;
  return <input value={String(value ?? '')} onChange={(e) => onChange(path, e.target.value)} />;
}

function labelForItem(v: unknown, k: string): string {
  if (v && typeof v === 'object' && 'name' in (v as Record<string, unknown>)) return String((v as { name: unknown }).name);
  return `#${k}`;
}
