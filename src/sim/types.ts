import type { RngState } from './rng';
import type { SimConfig } from './config';

export type TerrainId =
  | 'fertile_plain'
  | 'river_meadow'
  | 'plain'
  | 'forest'
  | 'hills'
  | 'desert'
  | 'tundra'
  | 'snow'
  | 'mountains'
  | 'lake'
  | 'ocean';

export type CloudClass = 'small' | 'medium' | 'large';
export type CharacterId = 'expansionist' | 'integrator' | 'isolationist' | 'trader' | 'conqueror';
export type StrategyId = 'expand' | 'consolidate' | 'integrate' | 'trade' | 'conquer' | 'isolate';

/** Static geography of one cell. Never changes after map generation. */
export interface Hex {
  idx: number;
  col: number;
  row: number;
  q: number;
  r: number;
  terrain: TerrainId;
  elevation: number;
  temperature: number;
  moisture: number;
  /** Fertility multiplier (≈0.2–1.6). */
  fertility: number;
  /** Fresh water availability 0..1. */
  freshWater: number;
  /** Cost to enter the cell; Infinity for impassable cells. */
  moveCost: number;
  /** Population carrying capacity K_h. */
  capacity: number;
  /** Upper bound of agricultural food output F_max. */
  agriPotential: number;
  /** Defensive attractiveness 0..1. */
  defense: number;
  /** Attractiveness as a settlement site 0..1. */
  appeal: number;
  /** River flow through the cell (0 = no river). */
  river: number;
  /** Downstream neighbour of the river, -1 if none. */
  riverTo: number;
  coastal: boolean;
}

export interface GameMap {
  width: number;
  height: number;
  hexes: Hex[];
}

/**
 * Population of one (cloud, race, culture) combination on one cell.
 * Rural and urban are two occupations of the same people, not separate pools.
 */
export interface PopGroup {
  cloud: number;
  race: number;
  culture: number;
  rural: number;
  urban: number;
}

export interface Cell {
  groups: PopGroup[];
  /** Stored food. */
  stock: number;
  settlement: number; // settlement id or -1
  // Last-turn food accounting, kept for display and for the next turn's decisions.
  food: {
    produced: number;
    need: number;
    imported: number;
    exported: number;
    fromStock: number;
    ratio: number; // consumed / need
    surplus: number; // produced - need (before transfers)
  };
  /** Exponential moving average of total population (stability check for settlements). */
  popAvg: number;
  /** Settlement whose service zone the cell belongs to (largest share), -1 if none. */
  zone: number;
}

export interface CultureTraits {
  langFamily: number;
  langBranch: number;
  religion: number;
  economy: number;
  /** Social norms in [0,1]: hierarchy, collectivism, openness. */
  norms: [number, number, number];
  /** Additional cultural features (tag ids). */
  tags: number[];
}

export interface Culture extends CultureTraits {
  id: number;
  name: string;
  hue: number;
  parents: number[];
  hybrid: boolean;
  createdTurn: number;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  /** Weights w_j of the utility function U(a) = Σ w_j V_j(a) − R(a). */
  weights: {
    expand: number;
    integrate: number;
    autonomy: number;
    trade: number;
    conquest: number;
  };
  riskAversion: number;
}

export interface RaceDef {
  id: number;
  name: string;
  growth: number;
  migration: number;
  cultureCapacity: number;
  cohesion: number;
  /** Adaptation to terrain types (multiplier on growth and migration preference). */
  affinity: Partial<Record<TerrainId, number>>;
  base: {
    langFamily: number;
    religion: number;
    economy: number;
    norms: [number, number, number];
  };
}

/** A culture group inside a cloud (a people that keeps its identity after integration). */
export interface InternalGroup {
  culture: number;
  race: number;
  isolation: number; // 0..100
  joinedTurn: number;
  origin: string;
  originCloud: number;
  hybridProgress: number;
  cohesion: number;
  schismRisk: number;
}

export interface Cloud {
  id: number;
  name: string;
  cls: CloudClass;
  race: number;
  culture: number;
  character: CharacterId;
  /** Isolation (обособленность) 0..100; meaningful for small and medium clouds. */
  isolation: number;
  /** Maximum number of cells (small clouds only); 0 = unlimited. */
  maxArea: number;
  hue: number;
  alive: boolean;
  absorbedInto: number;
  parent: number;
  bornTurn: number;
  diedTurn: number;
  groups: InternalGroup[];
  cohesion: number;
  load: number;
  capacity: number;
  institutions: number;
  strategy: StrategyId;
  strategyTurn: number;
  strategyReasons: Reason[];
  lastMajorTurn: number;
  /** Explored cells (0/1 per cell). */
  explored: number[];
  polity: number;
  stateStreak: number;
  stateReasons: Reason[];
  lastFoundingTurn: number;
  /** Accumulated secession pressure of a detached region. */
  secessionRisk: number;
}

export type RelationStatus = 'contact' | 'coexist' | 'trade' | 'alliance' | 'patronage' | 'war';

export interface Relation {
  a: number;
  b: number;
  contactTurn: number;
  attitude: number; // -100..100
  status: RelationStatus;
  statusSince: number;
  patron: number; // for patronage: id of the patron
  tradeTurns: number;
  sharedTurns: number;
  warTurns: number;
  lastProposalTurn: number;
  /** Turn the last war between the two ended (truce reference). */
  lastPeaceTurn: number;
  integration: null | { actor: number; target: number; progress: number; startTurn: number; distance: number };
  war: null | { aggressor: number; startTurn: number; weariness: number; lossesA: number; lossesB: number; reason: string };
}

export type SettlementLevel = 1 | 2 | 3;

export interface Settlement {
  id: number;
  name: string;
  hex: number;
  level: SettlementLevel;
  cloud: number;
  foundedTurn: number;
  alive: boolean;
  abandonedTurn: number;
  upStreak: number;
  downStreak: number;
  supplyAvg: number;
  jobs: number;
  servedPop: number;
  /** Jobs and zone surplus the settlement would command one level up. */
  potentialJobs: number;
  zoneSurplus: number;
  peakLevel: SettlementLevel;
  /** Why the last upgrade check failed (for diagnostics). */
  blockers: string[];
}

export interface Polity {
  id: number;
  name: string;
  cloud: number;
  capital: number; // settlement id
  foundedTurn: number;
  alive: boolean;
  endedTurn: number;
  hue: number;
  /** Turns without a qualifying capital. */
  crisis: number;
}

export interface Claim {
  p: number;
  s: number;
}

/** Recognised political status of a cell. */
export const NEUTRAL = -2;
export const SHARED = -3;

export interface Politics {
  claims: Claim[][];
  /** De facto control (polity id or -1). */
  control: number[];
  /** Recognised status: polity id, -1 none, NEUTRAL, SHARED. */
  recognized: number[];
  /** For SHARED cells: the two polities sharing the cell. */
  sharedBy: Array<[number, number] | null>;
  disputed: boolean[];
}

export type TreatyKind = 'border' | 'exchange' | 'neutral' | 'shared';

export interface Treaty {
  id: number;
  a: number;
  b: number;
  turn: number;
  kinds: TreatyKind[];
  cells: Array<{ idx: number; owner: number }>;
  /** Claim strengths at signature, used to detect major shifts. */
  baseline: Array<{ idx: number; sa: number; sb: number }>;
  alive: boolean;
  endedTurn: number;
  endReason: string;
}

export interface Negotiation {
  a: number;
  b: number;
  startTurn: number;
  lastRoundTurn: number;
  rounds: number;
  open: boolean;
}

export interface Reason {
  label: string;
  value: number;
}

export type EventType =
  | 'contact'
  | 'trade'
  | 'alliance'
  | 'patronage'
  | 'integration_start'
  | 'integration'
  | 'integration_refused'
  | 'hybrid'
  | 'assimilation'
  | 'settlement'
  | 'settlement_up'
  | 'settlement_down'
  | 'settlement_abandoned'
  | 'state'
  | 'state_collapse'
  | 'conflict'
  | 'peace'
  | 'schism'
  | 'treaty'
  | 'treaty_broken'
  | 'negotiation'
  | 'dispute'
  | 'famine'
  | 'extinction'
  | 'stabilized';

export interface SimEvent {
  turn: number;
  type: EventType;
  actors: number[];
  hex: number;
  cause: string;
  result: string;
}

export type DecisionKind =
  | 'strategy'
  | 'migration'
  | 'diplomacy'
  | 'integration'
  | 'war'
  | 'settlement'
  | 'settlement_upgrade'
  | 'state'
  | 'negotiation'
  | 'schism'
  | 'border';

export interface Decision {
  turn: number;
  cloud: number;
  kind: DecisionKind;
  title: string;
  hex: number;
  target: number;
  accepted: boolean;
  reasons: Reason[];
}

export interface CloudSample {
  id: number;
  pop: number;
  area: number;
  cohesion: number;
  load: number;
  capacity: number;
}

export interface TurnStats {
  turn: number;
  totalPop: number;
  urbanPop: number;
  villages: number;
  towns: number;
  cities: number;
  states: number;
  disputes: number;
  delimitedShare: number;
  wars: number;
  clouds: CloudSample[];
}

export interface StabilityState {
  stableTurns: number;
  finished: boolean;
  reason: string;
  stabilizedTurn: number;
  signature: number[];
  /** World population when the current stable window started. */
  popAtStart: number;
}

export interface SimState {
  version: number;
  config: SimConfig;
  seed: string;
  rng: RngState;
  turn: number;
  map: GameMap;
  cells: Cell[];
  races: RaceDef[];
  cultures: Culture[];
  clouds: Cloud[];
  relations: Relation[];
  settlements: Settlement[];
  polities: Polity[];
  politics: Politics;
  treaties: Treaty[];
  negotiations: Negotiation[];
  events: SimEvent[];
  decisions: Decision[];
  history: TurnStats[];
  stability: StabilityState;
  counters: {
    integrations: number;
    schisms: number;
    hybrids: number;
    wars: number;
    treaties: number;
    statesFormed: number;
    settlementsFounded: number;
    initialSmall: number;
    initialMedium: number;
    initialLarge: number;
    famineDeaths: number;
    warDeaths: number;
  };
}
