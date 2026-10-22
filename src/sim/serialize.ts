import { defaultConfig, mergeConfig, type SimConfig } from './config';
import { STATE_VERSION } from './init';
import type { SimState } from './types';

/**
 * JSON save/load. The state is plain data except for two details handled
 * here: Infinity (impassable move cost) and the per-cloud explored masks,
 * which are stored as compact "0101…" strings.
 */
const INF = '__Infinity__';

export function serializeState(state: SimState): string {
  return JSON.stringify(state, (key, value) => {
    if (value === Infinity) return INF;
    if (key === 'explored' && Array.isArray(value)) return value.join('');
    return value;
  });
}

export function deserializeState(text: string): SimState {
  const state = JSON.parse(text, (key, value) => {
    if (value === INF) return Infinity;
    if (key === 'explored' && typeof value === 'string') return Array.from(value, (ch) => (ch === '1' ? 1 : 0));
    return value;
  }) as SimState;
  if (!state || typeof state !== 'object' || !Array.isArray(state.cells) || !state.map) {
    throw new Error('Файл не похож на сохранение CCS');
  }
  if (state.version !== STATE_VERSION) throw new Error(`Неподдерживаемая версия сохранения: ${state.version}`);
  state.config = mergeConfig(defaultConfig(), state.config);
  return state;
}

export function serializeConfig(config: SimConfig): string {
  return JSON.stringify(config, null, 2);
}

export function parseConfig(text: string): SimConfig {
  const patch = JSON.parse(text);
  if (!patch || typeof patch !== 'object') throw new Error('Конфигурация должна быть JSON-объектом');
  return mergeConfig(defaultConfig(), patch);
}
