/// <reference lib="webworker" />
import { runToEnd } from '../sim/batch';
import type { SimConfig } from '../sim/config';

/** Runs batch experiments off the main thread so the UI stays responsive. */
interface Job {
  config: SimConfig;
  seeds: string[];
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { config, seeds } = e.data;
  seeds.forEach((seed, i) => {
    const summary = runToEnd(config, seed);
    (self as unknown as Worker).postMessage({ type: 'run', index: i, summary });
  });
  (self as unknown as Worker).postMessage({ type: 'done' });
};
