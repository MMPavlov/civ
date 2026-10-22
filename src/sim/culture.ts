import type { SimConfig } from './config';
import { clamp } from './noise';
import { int, rand, range, type RngState } from './rng';
import type { Culture, CultureTraits, RaceDef, SimState } from './types';

const SYLLABLES = ['ар', 'вен', 'тал', 'мор', 'кес', 'ул', 'дра', 'ис', 'хан', 'ло', 'зир', 'эб', 'он', 'са', 'риг', 'ту', 'мел', 'ка', 'ир', 'гон', 'фе', 'най', 'бор', 'ку', 'эль', 'вас', 'ти', 'рок', 'ше', 'ям'];

export function makeName(rng: RngState, syllables = 2 + int(rng, 0, 1)): string {
  let s = '';
  for (let i = 0; i < syllables; i++) s += SYLLABLES[int(rng, 0, SYLLABLES.length - 1)];
  return s[0].toUpperCase() + s.slice(1);
}

export const TAG_COUNT = 12;

/** New culture derived from a race template with random variation. */
export function newCultureFromRace(state: SimState, race: RaceDef, rng: RngState, name: string, hue: number): Culture {
  const n = race.base.norms;
  const tags: number[] = [];
  const tagCount = int(rng, 1, 3);
  while (tags.length < tagCount) {
    const t = int(rng, 0, TAG_COUNT - 1);
    if (!tags.includes(t)) tags.push(t);
  }
  const c: Culture = {
    id: state.cultures.length,
    name,
    hue,
    langFamily: rand(rng) < 0.85 ? race.base.langFamily : int(rng, 0, 5),
    langBranch: int(rng, 0, 9),
    religion: rand(rng) < 0.7 ? race.base.religion : int(rng, 0, 6),
    economy: rand(rng) < 0.75 ? race.base.economy : int(rng, 0, 3),
    norms: [
      clamp(n[0] + range(rng, -0.25, 0.25), 0, 1),
      clamp(n[1] + range(rng, -0.25, 0.25), 0, 1),
      clamp(n[2] + range(rng, -0.25, 0.25), 0, 1),
    ],
    tags: tags.sort((a, b) => a - b),
    parents: [],
    hybrid: false,
    createdTurn: state.turn,
  };
  state.cultures.push(c);
  return c;
}

/**
 * Normalised cultural distance in [0, 1]: weighted mix of language
 * (same branch 0, same family 0.45, else 1), religion and economy (same/other),
 * social norms (mean absolute difference) and extra tags (Jaccard distance).
 */
export function culturalDistance(a: CultureTraits, b: CultureTraits, cfg: SimConfig['culture']): number {
  const w = cfg.distanceWeights;
  const lang = a.langFamily !== b.langFamily ? 1 : a.langBranch !== b.langBranch ? 0.45 : 0;
  const rel = a.religion === b.religion ? 0 : 1;
  const eco = a.economy === b.economy ? 0 : 1;
  const norms = (Math.abs(a.norms[0] - b.norms[0]) + Math.abs(a.norms[1] - b.norms[1]) + Math.abs(a.norms[2] - b.norms[2])) / 3;
  const union = new Set([...a.tags, ...b.tags]).size;
  const inter = a.tags.filter((t) => b.tags.includes(t)).length;
  const tags = union === 0 ? 0 : 1 - inter / union;
  const total = w.language + w.religion + w.economy + w.norms + w.tags;
  return (w.language * lang + w.religion * rel + w.economy * eco + w.norms * Math.min(1, norms * 2) + w.tags * tags) / total;
}

export function distanceById(state: SimState, a: number, b: number): number {
  if (a === b) return 0;
  return culturalDistance(state.cultures[a], state.cultures[b], state.config.culture);
}

/**
 * Hybrid culture of a core culture and an integrated group. Continuous traits
 * are averaged by weight; categorical traits follow the heavier side, except
 * that a sizeable minority can pass on its religion/economy. Tags are merged.
 * `keep` is how much of the group's distinctiveness survives (0..1).
 */
export function makeHybrid(
  state: SimState,
  core: Culture,
  group: Culture,
  groupWeight: number,
  rng: RngState,
): Culture {
  const wg = clamp(groupWeight, 0, 1);
  const wc = 1 - wg;
  const pickCat = (c: number, g: number) => (rand(rng) < wg * 0.9 ? g : c);
  const tags = [...new Set([...core.tags, ...group.tags.filter(() => rand(rng) < 0.5 + wg)])].sort((x, y) => x - y).slice(0, 5);
  const hybrid: Culture = {
    id: state.cultures.length,
    name: hybridName(core.name, group.name),
    hue: mixHue(core.hue, group.hue, wg),
    langFamily: wg > 0.5 ? group.langFamily : core.langFamily,
    langBranch: wg > 0.35 ? (core.langBranch + group.langBranch + 1) % 10 : core.langBranch,
    religion: pickCat(core.religion, group.religion),
    economy: pickCat(core.economy, group.economy),
    norms: [
      core.norms[0] * wc + group.norms[0] * wg,
      core.norms[1] * wc + group.norms[1] * wg,
      core.norms[2] * wc + group.norms[2] * wg,
    ],
    tags,
    parents: [core.id, group.id],
    hybrid: true,
    createdTurn: state.turn,
  };
  state.cultures.push(hybrid);
  return hybrid;
}

function hybridName(a: string, b: string): string {
  const left = a.split('-')[0];
  const right = b.split('-').pop() ?? b;
  return `${left}-${right.slice(0, Math.max(3, Math.ceil(right.length / 2))).toLowerCase()}`;
}

export function mixHue(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (a + d * t + 360) % 360;
}
