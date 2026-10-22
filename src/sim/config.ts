import type { CharacterDef, CharacterId, CloudClass, RaceDef, TerrainId } from './types';

/**
 * Every tunable coefficient of the model lives here. Algorithms read these
 * values instead of hard-coding them, so an experiment can be reproduced from
 * (seed, config) alone. All values are experimental starting points.
 */

export interface TerrainDef {
  name: string;
  capacity: number;
  permeability: number;
  /** Agricultural yield factor: F_max = capacity × agri × food.yieldFactor. */
  agri: number;
  defense: number;
  /** Base fertility before local variation. */
  fertility: number;
  color: string;
  habitable: boolean;
}

export interface ClassDef {
  growth: number;
  migration: number;
  /** Initial area (cells) range. */
  initialArea: [number, number];
  /** Max area (cells) range; [0,0] = unlimited. */
  maxArea: [number, number];
  canSettle: boolean;
  canFormState: boolean;
  /** Initial population as share of local capacity. */
  initialDensity: number;
  isolation: [number, number];
}

export interface SimConfig {
  map: {
    width: number;
    height: number;
    landFraction: number;
    /** Temperature shift: -1 cold .. +1 warm. */
    climate: number;
    /** Moisture shift: -1 arid .. +1 wet. */
    humidity: number;
    mountainousness: number;
    rivers: number;
    fertility: number;
    tundra: boolean;
    snow: boolean;
    lakes: number;
    terrains: Record<TerrainId, TerrainDef>;
  };
  demography: {
    baseGrowth: number;
    foodPerCapita: number;
    famineMortality: number;
    migrationRate: number;
    crowdingStart: number;
    faminePush: number;
    expansionDrive: number;
    minGroup: number;
    stayBias: number;
    softmaxTemperature: number;
    /** Size of a pioneer group sent into new land; smaller flows into empty cells are not made. */
    pioneerSize: number;
    minSeed: number;
    /** Two-way exchange of people between neighbouring communities at peace (per turn). */
    exchangeRate: number;
  };
  food: {
    yieldFactor: number;
    /** L0 / K: labour scale of the production function F = Fmax(1 − e^(−L/L0)). */
    laborScale: number;
    transportLambda: number;
    transportRadius: number;
    riverCostFactor: number;
    stockPerCapita: number;
    spoilage: number;
    allocationRounds: number;
    flow: { same: number; ally: number; trade: number; patron: number; neutral: number; war: number };
  };
  clouds: {
    counts: Record<CloudClass, number>;
    classes: Record<CloudClass, ClassDef>;
    races: RaceDef[];
    characters: Record<CharacterId, CharacterDef>;
    sightRadius: number;
    largeCharacterMix: CharacterId[];
  };
  culture: {
    distanceWeights: { language: number; religion: number; economy: number; norms: number; tags: number };
    loadScale: number;
    loadIsolationBase: number;
    institutionsCapacityBonus: number;
    cohesionInertia: number;
    cohesionWeights: {
      closeness: number;
      overload: number;
      interests: number;
      economy: number;
      history: number;
      institutions: number;
      geography: number;
      conflict: number;
    };
    historyTurns: number;
    hybridRate: number;
    hybridCoreShare: number;
    hybridDistanceKeep: number;
    isolationDrift: number;
    schismThreshold: number;
    schismAccumulation: number;
    schismDecay: number;
    schismMinPop: number;
  };
  interactions: {
    contactRadius: number;
    attitudeDrift: number;
    attitudeDistancePenalty: number;
    tradeBonus: number;
    allianceBonus: number;
    warPenalty: number;
    frictionPenalty: number;
    tradeMinAttitude: number;
    allianceMinAttitude: number;
    patronageMinAttitude: number;
    integrationMinAttitude: number;
    integrationBaseTurns: number;
    integrationDistanceTurns: number;
    integrationCohesionCost: number;
    integrationIsolationGate: number;
    warMaxAttitude: number;
    warLossRate: number;
    warDisplacement: number;
    warWearinessRate: number;
    peaceWeariness: number;
    pairCooldown: number;
    /** Turns after a peace during which the same pair does not start a new war. */
    truceTurns: number;
    acceptanceNoise: number;
  };
  settlements: {
    /**
     * Service tiers (central-place hierarchy): tier t is offered only by
     * settlements of level ≥ t+1. Higher tiers have lower demand per person
     * but a longer range, so they need larger market areas.
     */
    tiers: Array<{ name: string; demandPerCapita: number; lambda: number; radius: number }>;
    surplusDemandBoost: number;
    /** Attractiveness bonus of higher-level providers within one tier. */
    levelAttraction: [number, number, number];
    sizeExponent: number;
    /** Weight of the "outside option" (households served by nobody) in the Huff shares. */
    coverageScale: number;
    upkeep: [number, number, number];
    urbanizationRate: number;
    deurbanizationRate: number;
    tradeJobsRiver: number;
    tradeJobsCoast: number;
    adminJobsPerCell: number;
    village: { minPop: number; minAppeal: number; minSurplus: number; minUnserved: number; minCaptured: number; minFreeShare: number };
    town: { minUrban: number; minJobs: number; minServed: number; minSupply: number; minNonAgri: number; minAppeal: number; minSurplus: number };
    city: { minUrban: number; minJobs: number; minServed: number; minSupply: number; minNonAgri: number; minAppeal: number; minSurplus: number };
    upgradeTurns: number;
    declineTurns: number;
    declineSupply: number;
    declineJobsRatio: number;
    foundingCooldown: number;
  };
  states: {
    minPopulation: number;
    minCapitalLevel: number;
    minInstitutions: number;
    minSurplus: number;
    formationTurns: number;
    institutionsGrowth: number;
    institutionsDecay: number;
    adminRadiusBase: number;
    adminRadiusPerInstitution: number;
    claimWeights: { population: number; proximity: number; economy: number; access: number; strategic: number };
    claimThreshold: number;
    controlThreshold: number;
    negotiationCooldown: number;
    treatyMinDuration: number;
    reviewThreshold: number;
    neutralEpsilon: number;
    sharedMinAttitude: number;
    sharedMinMix: number;
    warCostWeight: number;
    collapseTurns: number;
  };
  sim: {
    maxTurns: number;
    stabilityWindow: number;
    decisionInterval: number;
    maxMajorActionsPerTurn: number;
    maxEvents: number;
    maxDecisions: number;
    logMigrationDecisions: boolean;
  };
}

const terrains: Record<TerrainId, TerrainDef> = {
  fertile_plain: { name: 'Плодородная равнина', capacity: 120, permeability: 1.0, agri: 1.5, defense: 0.1, fertility: 1.25, color: '#9bc56b', habitable: true },
  river_meadow: { name: 'Луг около реки', capacity: 150, permeability: 1.2, agri: 1.55, defense: 0.15, fertility: 1.4, color: '#6fbf73', habitable: true },
  plain: { name: 'Обычная равнина', capacity: 100, permeability: 1.0, agri: 1.35, defense: 0.1, fertility: 1.0, color: '#c8d48a', habitable: true },
  forest: { name: 'Лес', capacity: 85, permeability: 0.7, agri: 1.2, defense: 0.45, fertility: 0.85, color: '#4f8a4a', habitable: true },
  hills: { name: 'Холмы', capacity: 65, permeability: 0.6, agri: 1.2, defense: 0.7, fertility: 0.75, color: '#b39b6b', habitable: true },
  desert: { name: 'Пустыня', capacity: 20, permeability: 0.3, agri: 1.1, defense: 0.2, fertility: 0.25, color: '#e6d39a', habitable: true },
  tundra: { name: 'Тундра', capacity: 25, permeability: 0.4, agri: 1.1, defense: 0.2, fertility: 0.3, color: '#a9b8b0', habitable: true },
  snow: { name: 'Снега', capacity: 0, permeability: 0.15, agri: 0, defense: 0.3, fertility: 0, color: '#eef3f6', habitable: false },
  mountains: { name: 'Горы', capacity: 0, permeability: 0, agri: 0, defense: 1, fertility: 0, color: '#8a7f78', habitable: false },
  lake: { name: 'Озеро', capacity: 0, permeability: 0, agri: 0, defense: 0, fertility: 0, color: '#6fa8dc', habitable: false },
  ocean: { name: 'Океан', capacity: 0, permeability: 0, agri: 0, defense: 0, fertility: 0, color: '#2f5f8f', habitable: false },
};

const races: RaceDef[] = [
  {
    id: 0, name: 'Равнинники', growth: 1.0, migration: 1.0, cultureCapacity: 5, cohesion: 1.0,
    affinity: { fertile_plain: 1.15, river_meadow: 1.1, plain: 1.1, forest: 0.85, hills: 0.8, desert: 0.6, tundra: 0.6 },
    base: { langFamily: 0, religion: 0, economy: 0, norms: [0.5, 0.5, 0.6] },
  },
  {
    id: 1, name: 'Степняки', growth: 1.3, migration: 1.2, cultureCapacity: 2, cohesion: 0.9,
    affinity: { fertile_plain: 1.0, river_meadow: 1.0, plain: 1.2, forest: 0.7, hills: 0.85, desert: 0.9, tundra: 0.7 },
    base: { langFamily: 1, religion: 1, economy: 1, norms: [0.6, 0.7, 0.4] },
  },
  {
    id: 2, name: 'Лесной народ', growth: 0.9, migration: 0.8, cultureCapacity: 4, cohesion: 1.1,
    affinity: { fertile_plain: 0.95, river_meadow: 1.0, plain: 0.9, forest: 1.35, hills: 0.9, desert: 0.4, tundra: 0.8 },
    base: { langFamily: 2, religion: 2, economy: 2, norms: [0.3, 0.6, 0.5] },
  },
  {
    id: 3, name: 'Горцы', growth: 0.85, migration: 0.7, cultureCapacity: 3, cohesion: 1.25,
    affinity: { fertile_plain: 0.9, river_meadow: 0.9, plain: 0.9, forest: 1.0, hills: 1.45, desert: 0.6, tundra: 0.9 },
    base: { langFamily: 3, religion: 3, economy: 1, norms: [0.7, 0.8, 0.2] },
  },
  {
    id: 4, name: 'Речной народ', growth: 1.1, migration: 0.9, cultureCapacity: 4, cohesion: 1.0,
    affinity: { fertile_plain: 1.05, river_meadow: 1.4, plain: 0.95, forest: 0.85, hills: 0.75, desert: 0.5, tundra: 0.5 },
    base: { langFamily: 0, religion: 4, economy: 3, norms: [0.5, 0.4, 0.8] },
  },
  {
    id: 5, name: 'Северяне', growth: 0.95, migration: 1.0, cultureCapacity: 3, cohesion: 1.15,
    affinity: { fertile_plain: 0.9, river_meadow: 0.9, plain: 0.95, forest: 1.1, hills: 1.0, desert: 0.3, tundra: 1.5 },
    base: { langFamily: 4, religion: 5, economy: 2, norms: [0.6, 0.6, 0.3] },
  },
];

const characters: Record<CharacterId, CharacterDef> = {
  expansionist: { id: 'expansionist', name: 'Экспансионист', weights: { expand: 1.0, integrate: 0.3, autonomy: 0.3, trade: 0.35, conquest: 0.4 }, riskAversion: 0.8 },
  integrator: { id: 'integrator', name: 'Интегратор', weights: { expand: 0.4, integrate: 1.0, autonomy: 0.25, trade: 0.6, conquest: 0.15 }, riskAversion: 1.0 },
  isolationist: { id: 'isolationist', name: 'Изоляционист', weights: { expand: 0.25, integrate: 0.1, autonomy: 1.0, trade: 0.3, conquest: 0.1 }, riskAversion: 1.4 },
  trader: { id: 'trader', name: 'Торговец', weights: { expand: 0.35, integrate: 0.45, autonomy: 0.3, trade: 1.0, conquest: 0.1 }, riskAversion: 1.1 },
  conqueror: { id: 'conqueror', name: 'Завоеватель', weights: { expand: 0.6, integrate: 0.35, autonomy: 0.2, trade: 0.2, conquest: 1.0 }, riskAversion: 0.6 },
};

export function defaultConfig(): SimConfig {
  return {
    map: {
      width: 42,
      height: 28,
      landFraction: 0.62,
      climate: 0,
      humidity: 0,
      mountainousness: 0.5,
      rivers: 7,
      fertility: 1.0,
      tundra: true,
      snow: true,
      lakes: 3,
      terrains: structuredClone(terrains),
    },
    demography: {
      baseGrowth: 0.045,
      foodPerCapita: 1.0,
      famineMortality: 0.35,
      migrationRate: 0.07,
      crowdingStart: 0.45,
      faminePush: 1.5,
      expansionDrive: 0.04,
      minGroup: 0.5,
      stayBias: 0.35,
      softmaxTemperature: 0.18,
      pioneerSize: 4,
      minSeed: 1.5,
      exchangeRate: 0.012,
    },
    food: {
      yieldFactor: 1.0,
      laborScale: 0.6,
      transportLambda: 0.35,
      transportRadius: 6,
      riverCostFactor: 0.45,
      stockPerCapita: 0.5,
      spoilage: 0.3,
      allocationRounds: 4,
      flow: { same: 1.0, ally: 0.8, trade: 0.7, patron: 0.7, neutral: 0.15, war: 0 },
    },
    clouds: {
      counts: { large: 4, medium: 10, small: 20 },
      classes: {
        small: { growth: 0.35, migration: 0.3, initialArea: [1, 1], maxArea: [2, 3], canSettle: false, canFormState: false, initialDensity: 0.45, isolation: [10, 95] },
        medium: { growth: 0.75, migration: 0.7, initialArea: [3, 5], maxArea: [0, 0], canSettle: true, canFormState: true, initialDensity: 0.4, isolation: [10, 85] },
        large: { growth: 1.0, migration: 1.0, initialArea: [5, 9], maxArea: [0, 0], canSettle: true, canFormState: true, initialDensity: 0.4, isolation: [0, 0] },
      },
      races: structuredClone(races),
      characters: structuredClone(characters),
      sightRadius: 2,
      largeCharacterMix: ['expansionist', 'integrator', 'trader', 'conqueror', 'isolationist'],
    },
    culture: {
      distanceWeights: { language: 0.3, religion: 0.2, economy: 0.15, norms: 0.25, tags: 0.1 },
      loadScale: 9,
      loadIsolationBase: 0.3,
      institutionsCapacityBonus: 0.8,
      cohesionInertia: 0.08,
      cohesionWeights: { closeness: 0.25, overload: 0.35, interests: 0.1, economy: 0.15, history: 0.12, institutions: 0.12, geography: 0.18, conflict: 0.15 },
      historyTurns: 60,
      hybridRate: 0.012,
      hybridCoreShare: 0.3,
      hybridDistanceKeep: 0.45,
      isolationDrift: 0.15,
      schismThreshold: 1.0,
      schismAccumulation: 0.12,
      schismDecay: 0.04,
      schismMinPop: 120,
    },
    interactions: {
      contactRadius: 1,
      attitudeDrift: 0.06,
      attitudeDistancePenalty: 30,
      tradeBonus: 0.9,
      allianceBonus: 0.6,
      warPenalty: 2.5,
      frictionPenalty: 3,
      tradeMinAttitude: -5,
      allianceMinAttitude: 40,
      patronageMinAttitude: 0,
      integrationMinAttitude: 8,
      integrationBaseTurns: 6,
      integrationDistanceTurns: 24,
      integrationCohesionCost: 0.08,
      integrationIsolationGate: 75,
      warMaxAttitude: -15,
      warLossRate: 0.025,
      warDisplacement: 0.12,
      warWearinessRate: 0.04,
      peaceWeariness: 1.0,
      pairCooldown: 6,
      truceTurns: 30,
      acceptanceNoise: 0.15,
    },
    settlements: {
      tiers: [
        { name: 'местный обмен', demandPerCapita: 0.045, lambda: 0.9, radius: 3 },
        { name: 'ремёсла и рынок', demandPerCapita: 0.022, lambda: 0.45, radius: 5 },
        { name: 'управление и дальняя торговля', demandPerCapita: 0.012, lambda: 0.22, radius: 8 },
      ],
      surplusDemandBoost: 0.6,
      levelAttraction: [1, 1.3, 1.6],
      sizeExponent: 0.35,
      coverageScale: 0.6,
      upkeep: [1, 4, 12],
      urbanizationRate: 0.15,
      deurbanizationRate: 0.2,
      tradeJobsRiver: 4,
      tradeJobsCoast: 3,
      adminJobsPerCell: 0.6,
      village: { minPop: 45, minAppeal: 0.35, minSurplus: 10, minUnserved: 12, minCaptured: 18, minFreeShare: 0.5 },
      town: { minUrban: 15, minJobs: 38, minServed: 700, minSupply: 0.97, minNonAgri: 0.1, minAppeal: 0.5, minSurplus: 40 },
      city: { minUrban: 60, minJobs: 80, minServed: 2600, minSupply: 0.98, minNonAgri: 0.25, minAppeal: 0.6, minSurplus: 140 },
      upgradeTurns: 10,
      declineTurns: 8,
      declineSupply: 0.85,
      declineJobsRatio: 0.5,
      foundingCooldown: 3,
    },
    states: {
      minPopulation: 1500,
      minCapitalLevel: 2,
      minInstitutions: 0.35,
      minSurplus: 40,
      formationTurns: 10,
      institutionsGrowth: 0.012,
      institutionsDecay: 0.004,
      adminRadiusBase: 4,
      adminRadiusPerInstitution: 6,
      claimWeights: { population: 0.5, proximity: 0.35, economy: 0.2, access: 0.15, strategic: 0.2 },
      claimThreshold: 0.25,
      controlThreshold: 0.35,
      negotiationCooldown: 8,
      treatyMinDuration: 40,
      reviewThreshold: 0.4,
      neutralEpsilon: 0.06,
      sharedMinAttitude: 30,
      sharedMinMix: 0.25,
      warCostWeight: 1.0,
      collapseTurns: 10,
    },
    sim: {
      maxTurns: 300,
      stabilityWindow: 20,
      decisionInterval: 5,
      maxMajorActionsPerTurn: 1,
      maxEvents: 6000,
      maxDecisions: 4000,
      logMigrationDecisions: true,
    },
  };
}

/** Deep-merge a partial config (e.g. loaded from JSON) onto the defaults. */
export function mergeConfig(base: SimConfig, patch: unknown): SimConfig {
  return deepMerge(structuredClone(base), patch) as SimConfig;
}

function deepMerge(target: unknown, patch: unknown): unknown {
  if (patch === undefined) return target;
  if (Array.isArray(patch)) return structuredClone(patch);
  if (patch !== null && typeof patch === 'object') {
    const out = (target && typeof target === 'object' && !Array.isArray(target) ? target : {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return patch;
}
