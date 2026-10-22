import { effectiveCapacity } from '../sim/demography';
import { cellTotal, cultureDiversity } from '../sim/pop';
import { NEUTRAL, SHARED, type SimState } from '../sim/types';
import { cloudColor, diverging, hexToRgb, mix, polityColor, ramp, rgbToHex, SEQ_BLUE, SEQ_ORANGE } from './colors';

export type MapMode = 'geography' | 'clouds' | 'density' | 'mixed' | 'food' | 'settlements' | 'claims' | 'borders';

export const MAP_MODES: Array<{ id: MapMode; name: string }> = [
  { id: 'geography', name: 'География' },
  { id: 'clouds', name: 'Культурные облака' },
  { id: 'density', name: 'Плотность населения' },
  { id: 'mixed', name: 'Смешанный состав' },
  { id: 'food', name: 'Продовольствие' },
  { id: 'settlements', name: 'Поселения и зоны' },
  { id: 'claims', name: 'Претензии' },
  { id: 'borders', name: 'Границы' },
];

/** What the current observer is allowed to see. */
export interface Lens {
  observer: number; // -1 = global observer
  explored: number[] | null;
  visible: Set<number> | null;
}

export const FOG = '#2b2f35';

export function isKnown(lens: Lens, idx: number): boolean {
  return lens.observer < 0 || !!lens.explored?.[idx];
}

export function isVisibleNow(lens: Lens, idx: number): boolean {
  return lens.observer < 0 || !!lens.visible?.has(idx);
}

export function terrainColor(state: SimState, idx: number): string {
  return state.config.map.terrains[state.map.hexes[idx].terrain].color;
}

function paleTerrain(state: SimState, idx: number): string {
  return mix(terrainColor(state, idx), '#f4f3ef', 0.72);
}

/** Fill colour of a cell in the given mode, respecting the observer's knowledge. */
export function cellFill(state: SimState, mode: MapMode, idx: number, lens: Lens): string {
  if (!isKnown(lens, idx)) return FOG;
  const hex = state.map.hexes[idx];
  const water = hex.terrain === 'ocean' || hex.terrain === 'lake';
  if (water || mode === 'geography') return terrainColor(state, idx);
  if (!isVisibleNow(lens, idx)) return mix(terrainColor(state, idx), '#6b6f75', 0.55);
  const cell = state.cells[idx];
  const N = cellTotal(cell);
  switch (mode) {
    case 'clouds': {
      if (N <= 0.5) return paleTerrain(state, idx);
      const acc = [0, 0, 0];
      for (const g of cell.groups) {
        const w = (g.rural + g.urban) / N;
        const [r, gg, b] = hexToRgb(cloudColor(state, g.cloud));
        acc[0] += r * w;
        acc[1] += gg * w;
        acc[2] += b * w;
      }
      const presence = Math.min(1, N / Math.max(30, effectiveCapacity(state, idx)));
      return mix(paleTerrain(state, idx), rgbToHex(acc as [number, number, number]), 0.25 + 0.75 * presence);
    }
    case 'density': {
      if (N <= 0.5) return paleTerrain(state, idx);
      return ramp(SEQ_BLUE, Math.min(1, N / 220));
    }
    case 'mixed': {
      if (N <= 0.5) return paleTerrain(state, idx);
      return ramp(SEQ_ORANGE, Math.min(1, cultureDiversity(cell) / 1.1));
    }
    case 'food': {
      if (hex.capacity <= 0) return paleTerrain(state, idx);
      if (N <= 0.5) return mix('#f4f3ef', '#9b9a94', Math.min(1, hex.agriPotential / 230) * 0.6);
      const f = cell.food;
      const bal = f.need > 0 ? (f.produced + f.imported - f.need) / f.need : 0;
      return diverging(Math.max(-1, Math.min(1, bal * 2.5)));
    }
    case 'settlements': {
      const z = cell.zone;
      if (z < 0 || !state.settlements[z]?.alive) return paleTerrain(state, idx);
      return mix(paleTerrain(state, idx), cloudColor(state, state.settlements[z].cloud), 0.45);
    }
    case 'claims': {
      const claims = state.politics.claims[idx];
      if (!claims.length) return paleTerrain(state, idx);
      const top = claims[0];
      return mix(paleTerrain(state, idx), polityColor(state, top.p), Math.min(0.85, 0.25 + top.s * 0.7));
    }
    case 'borders': {
      const rec = state.politics.recognized[idx];
      if (rec >= 0) return mix(paleTerrain(state, idx), polityColor(state, rec), 0.6);
      if (rec === NEUTRAL) return '#d9d8d2';
      if (rec === SHARED) {
        const pair = state.politics.sharedBy[idx];
        return pair ? mix(polityColor(state, pair[0]), polityColor(state, pair[1]), 0.5) : '#c3c2b7';
      }
      const ctl = state.politics.control[idx];
      if (ctl >= 0) return mix(paleTerrain(state, idx), polityColor(state, ctl), 0.3);
      return paleTerrain(state, idx);
    }
    default:
      return terrainColor(state, idx);
  }
}

export interface LegendItem {
  color: string;
  label: string;
  pattern?: 'hatch' | 'stripe';
}

export function legendFor(state: SimState, mode: MapMode): { title: string; items: LegendItem[]; gradient?: { colors: string[]; from: string; to: string } } {
  switch (mode) {
    case 'geography':
      return {
        title: 'Местность',
        items: (Object.keys(state.config.map.terrains) as Array<keyof typeof state.config.map.terrains>).map((t) => ({
          color: state.config.map.terrains[t].color,
          label: state.config.map.terrains[t].name,
        })),
      };
    case 'clouds':
      return {
        title: 'Цвет — облако, насыщенность — степень присутствия; точка — смешанная клетка',
        items: state.clouds.filter((c) => c.alive && c.cls === 'large').map((c) => ({ color: cloudColor(state, c.id), label: c.name })),
      };
    case 'density':
      return { title: 'Население клетки', items: [], gradient: { colors: SEQ_BLUE, from: '0', to: '220+' } };
    case 'mixed':
      return { title: 'Культурное разнообразие (индекс Шеннона)', items: [], gradient: { colors: SEQ_ORANGE, from: '0', to: '1.1+' } };
    case 'food':
      return {
        title: 'Продовольственный баланс (производство + импорт − потребность)',
        items: [],
        gradient: { colors: [DIVERGING_STOPS[0], DIVERGING_STOPS[1], DIVERGING_STOPS[2]], from: 'дефицит', to: 'избыток' },
      };
    case 'settlements':
      return {
        title: 'Зоны хозяйственного обслуживания (местный уровень)',
        items: [
          { color: '#52514e', label: '● деревня' },
          { color: '#52514e', label: '■ городок' },
          { color: '#52514e', label: '★ город' },
        ],
      };
    case 'claims':
      return {
        title: 'Сильнейшая претензия; штриховка — спорная клетка',
        items: [
          ...state.polities.filter((p) => p.alive).map((p) => ({ color: polityColor(state, p.id), label: p.name })),
          { color: '#e34948', label: 'спор', pattern: 'hatch' as const },
        ],
      };
    case 'borders':
      return {
        title: 'Признанная принадлежность',
        items: [
          ...state.polities.filter((p) => p.alive).map((p) => ({ color: polityColor(state, p.id), label: p.name })),
          { color: '#d9d8d2', label: 'нейтральная полоса' },
          { color: '#c3c2b7', label: 'совместное использование', pattern: 'stripe' as const },
        ],
      };
  }
}

const DIVERGING_STOPS = ['#e34948', '#f0efec', '#2a78d6'];
