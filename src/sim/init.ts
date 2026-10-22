import { defaultConfig, type SimConfig } from './config';
import { makeName, newCultureFromRace } from './culture';
import { getGeo } from './geo';
import { generateMap } from './mapgen';
import { addPop } from './pop';
import { fork, int, makeRng, pick, rand, range, shuffle, type RngState } from './rng';
import { recordStats } from './stats';
import type { Cell, CharacterId, Cloud, CloudClass, GameMap, Politics, SimState } from './types';
import { updateVisibility } from './visibility';

export const STATE_VERSION = 1;

export function emptyCell(): Cell {
  return {
    groups: [],
    stock: 0,
    settlement: -1,
    food: { produced: 0, need: 0, imported: 0, exported: 0, fromStock: 0, ratio: 1, surplus: 0 },
    popAvg: 0,
    zone: -1,
  };
}

export function emptyPolitics(n: number): Politics {
  return {
    claims: Array.from({ length: n }, () => []),
    control: new Array<number>(n).fill(-1),
    recognized: new Array<number>(n).fill(-1),
    sharedBy: new Array(n).fill(null),
    disputed: new Array<boolean>(n).fill(false),
  };
}

/** Bare state on a given map, without any clouds. */
export function createEmptyState(config: SimConfig, seed: string, map: GameMap): SimState {
  const n = map.hexes.length;
  return {
    version: STATE_VERSION,
    config,
    seed,
    rng: makeRng(`${seed}::sim`),
    turn: 0,
    map,
    cells: Array.from({ length: n }, emptyCell),
    races: structuredClone(config.clouds.races),
    cultures: [],
    clouds: [],
    relations: [],
    settlements: [],
    polities: [],
    politics: emptyPolitics(n),
    treaties: [],
    negotiations: [],
    events: [],
    decisions: [],
    history: [],
    stability: { stableTurns: 0, finished: false, reason: '', stabilizedTurn: -1, signature: [], popAtStart: 0 },
    counters: {
      integrations: 0, schisms: 0, hybrids: 0, wars: 0, treaties: 0, statesFormed: 0, settlementsFounded: 0,
      initialSmall: 0, initialMedium: 0, initialLarge: 0, famineDeaths: 0, warDeaths: 0,
    },
  };
}

export interface CloudSpec {
  cls: CloudClass;
  race: number;
  character?: CharacterId;
  isolation?: number;
  cells: number[];
  density?: number;
  name?: string;
  hue?: number;
}

/** Create a cloud with its own culture and initial population on the given cells. */
export function addCloud(state: SimState, spec: CloudSpec, rng: RngState): Cloud {
  const cfg = state.config.clouds;
  const cls = cfg.classes[spec.cls];
  const race = state.races[spec.race];
  const id = state.clouds.length;
  const name = spec.name ?? makeName(rng);
  const hue = spec.hue ?? Math.floor(rand(rng) * 360);
  const culture = newCultureFromRace(state, race, rng, name, hue);
  const isolation =
    spec.isolation ?? (spec.cls === 'large' ? 0 : Math.round(range(rng, cls.isolation[0], cls.isolation[1])));
  const character = spec.character ?? defaultCharacter(spec.cls, isolation, rng);
  const cloud: Cloud = {
    id, name, cls: spec.cls, race: race.id, culture: culture.id, character, isolation,
    maxArea: cls.maxArea[1] > 0 ? int(rng, cls.maxArea[0], cls.maxArea[1]) : 0,
    hue, alive: true, absorbedInto: -1, parent: -1, bornTurn: state.turn, diedTurn: -1,
    groups: [{
      culture: culture.id, race: race.id, isolation, joinedTurn: state.turn, origin: name, originCloud: id,
      hybridProgress: 0, cohesion: 0.8, schismRisk: 0,
    }],
    cohesion: 0.8, load: 0, capacity: race.cultureCapacity,
    institutions: 0,
    strategy: 'expand', strategyTurn: -999, strategyReasons: [],
    lastMajorTurn: -999,
    explored: new Array<number>(state.map.hexes.length).fill(0),
    polity: -1, stateStreak: 0, stateReasons: [], lastFoundingTurn: -999, secessionRisk: 0,
  };
  state.clouds.push(cloud);
  const density = spec.density ?? cls.initialDensity;
  for (const idx of spec.cells) {
    const k = state.map.hexes[idx].capacity;
    addPop(state.cells[idx], id, race.id, culture.id, Math.max(4, k * density * range(rng, 0.8, 1.2)));
  }
  return cloud;
}

function defaultCharacter(cls: CloudClass, isolation: number, rng: RngState): CharacterId {
  if (cls === 'small') {
    if (isolation > 65) return 'isolationist';
    return pick(rng, ['trader', 'integrator', 'isolationist', 'trader'] as CharacterId[]);
  }
  return pick(rng, ['expansionist', 'integrator', 'isolationist', 'trader', 'conqueror'] as CharacterId[]);
}

/** Full simulation from (config, seed): map, initial clouds, visibility, first stats sample. */
export function createSimulation(config: SimConfig = defaultConfig(), seed: string | number = 'ccs-1'): SimState {
  const seedText = String(seed);
  const map = generateMap(config.map, seedText);
  const state = createEmptyState(config, seedText, map);
  placeInitialClouds(state);
  updateVisibility(state);
  recordStats(state);
  return state;
}

function placeInitialClouds(state: SimState): void {
  const rng = fork(state.seed, 'placement');
  const geo = getGeo(state);
  const hexes = state.map.hexes;
  const occupied = new Array<boolean>(hexes.length).fill(false);
  const habitable = hexes.filter((h) => h.capacity > 0).map((h) => h.idx);
  const counts = state.config.clouds.counts;
  const raceIds = state.races.map((r) => r.id);
  const largeRaces = shuffle(rng, [...raceIds]);
  const characterMix = shuffle(rng, [...state.config.clouds.largeCharacterMix]);
  const seeds: number[] = [];

  const dist = (a: number, b: number) => {
    const ha = hexes[a];
    const hb = hexes[b];
    const dq = ha.q - hb.q;
    const dr = ha.r - hb.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  };

  const pickSeed = (minCapacity: number, spreadWeight: number): number => {
    const candidates = habitable.filter((i) => !occupied[i] && hexes[i].capacity >= minCapacity);
    const pool = candidates.length ? candidates : habitable.filter((i) => !occupied[i]);
    if (!pool.length) return -1;
    let best = -1;
    let bestScore = -Infinity;
    for (const i of pool) {
      const d = seeds.length ? Math.min(...seeds.map((s) => dist(s, i))) : 10;
      const score = spreadWeight * Math.min(d, 14) + hexes[i].capacity / 40 + 3 * rand(rng);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  };

  const grow = (start: number, size: number): number[] => {
    const area = [start];
    occupied[start] = true;
    while (area.length < size) {
      const frontier = new Set<number>();
      for (const i of area) for (const n of geo.neighbors[i]) if (!occupied[n] && hexes[n].capacity > 0) frontier.add(n);
      if (!frontier.size) break;
      const options = [...frontier].sort((a, b) => a - b);
      const weights = options.map((i) => hexes[i].capacity + 20 * rand(rng));
      let bi = 0;
      for (let k = 1; k < options.length; k++) if (weights[k] > weights[bi]) bi = k;
      area.push(options[bi]);
      occupied[options[bi]] = true;
    }
    return area;
  };

  const make = (cls: CloudClass, i: number) => {
    const def = state.config.clouds.classes[cls];
    const start = pickSeed(cls === 'small' ? 10 : cls === 'medium' ? 50 : 80, cls === 'small' ? 0.6 : cls === 'medium' ? 1.2 : 2);
    if (start < 0) return;
    seeds.push(start);
    const size = int(rng, def.initialArea[0], def.initialArea[1]);
    const cells = grow(start, size);
    const race = cls === 'large' ? largeRaces[i % largeRaces.length] : pick(rng, raceIds);
    const character = cls === 'large' ? characterMix[i % characterMix.length] : undefined;
    const hue = cls === 'large' ? (i * (360 / Math.max(1, counts.large)) + 20) % 360 : undefined;
    addCloud(state, { cls, race, cells, character, hue }, rng);
  };

  for (let i = 0; i < counts.large; i++) make('large', i);
  for (let i = 0; i < counts.medium; i++) make('medium', i);
  for (let i = 0; i < counts.small; i++) make('small', i);
  state.counters.initialLarge = state.clouds.filter((c) => c.cls === 'large').length;
  state.counters.initialMedium = state.clouds.filter((c) => c.cls === 'medium').length;
  state.counters.initialSmall = state.clouds.filter((c) => c.cls === 'small').length;
}
