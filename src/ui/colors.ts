import type { SimState } from '../sim/types';

/**
 * Colour roles for the map and charts (reference palette of the dataviz
 * method). Large clouds take the categorical slots in fixed order of their
 * id, so a people keeps its colour on the map, in the charts and in cards.
 */
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const OTHER_GRAY = '#898781';

/** Sequential blue ramp, steps 100 → 700. */
export const SEQ_BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
/** Second sequential hue (orange), light → dark. */
export const SEQ_ORANGE = ['#fde6da', '#fbd0b9', '#f8b896', '#f39f73', '#ef8652', '#eb6834', '#d0561f', '#b04615', '#8f390f', '#6f2c0b'];
export const DIVERGING = { negative: '#e34948', neutral: '#f0efec', positive: '#2a78d6' };

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([255 * f(0), 255 * f(8), 255 * f(4)]);
}

/** Pick a colour from a ramp for t in [0, 1]. */
export function ramp(steps: string[], t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (steps.length - 1);
  const i = Math.floor(x);
  if (i >= steps.length - 1) return steps[steps.length - 1];
  return mix(steps[i], steps[i + 1], x - i);
}

export function diverging(t: number): string {
  // t in [-1, 1]
  if (t < 0) return mix(DIVERGING.neutral, DIVERGING.negative, Math.min(1, -t));
  return mix(DIVERGING.neutral, DIVERGING.positive, Math.min(1, t));
}

const slotCache = new WeakMap<SimState['clouds'], Map<number, number>>();

/** Categorical slot of a large cloud (stable: ordered by id among clouds that were ever large), or -1. */
export function largeSlot(state: SimState, id: number): number {
  let m = slotCache.get(state.clouds);
  if (!m || m.size !== state.clouds.filter((c) => c.cls === 'large').length) {
    m = new Map();
    let k = 0;
    for (const c of state.clouds) if (c.cls === 'large') m.set(c.id, k++);
    slotCache.set(state.clouds, m);
  }
  return m.get(id) ?? -1;
}

export function cloudColor(state: SimState, id: number): string {
  const c = state.clouds[id];
  if (!c) return OTHER_GRAY;
  const slot = largeSlot(state, id);
  if (slot >= 0 && slot < CATEGORICAL.length) return CATEGORICAL[slot];
  return hslToHex(c.hue, c.cls === 'medium' ? 42 : 30, c.cls === 'medium' ? 52 : 60);
}

export function polityColor(state: SimState, pid: number): string {
  const p = state.polities[pid];
  return p ? cloudColor(state, p.cloud) : OTHER_GRAY;
}

export function cultureColor(state: SimState, cultureId: number): string {
  const c = state.cultures[cultureId];
  return c ? hslToHex(c.hue, 48, 50) : OTHER_GRAY;
}
