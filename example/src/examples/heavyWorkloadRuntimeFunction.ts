import { runtimeFunction } from '@react-native-runtimes/core';

export type HeavyRunResult = {
  n: number;
  result: number;
  durationMs: number;
  runtimeKind: string;
  runtimeName: string;
};

export const HEAVY_WORKLOAD_MIN_N = 28;
export const HEAVY_WORKLOAD_MAX_N = 40;

export function clampHeavyInput(n: number): number {
  if (!Number.isFinite(n)) {
    return HEAVY_WORKLOAD_MIN_N;
  }
  return Math.max(
    HEAVY_WORKLOAD_MIN_N,
    Math.min(HEAVY_WORKLOAD_MAX_N, Math.floor(n)),
  );
}

// Naive O(2^n) fibonacci. This is deliberately heavy: it is the workload whose
// cost we want to make visible. Running it fully occupies whichever JS runtime
// executes it, so on the main runtime it freezes the UI and on a worker runtime
// it does not.
function recursiveFibonacci(n: number): number {
  if (n < 2) {
    return n;
  }
  return recursiveFibonacci(n - 1) + recursiveFibonacci(n - 2);
}

function runtimeInfo() {
  const globals = globalThis as {
    __THREADED_RUNTIME_ENV__?: { kind?: string; runtimeName?: string };
    __COMPOSE_CHAT_LIST_ENV__?: { kind?: string; runtimeName?: string };
  };
  const threadedEnv = globals.__THREADED_RUNTIME_ENV__;
  const listEnv = globals.__COMPOSE_CHAT_LIST_ENV__;
  return {
    runtimeKind: threadedEnv?.kind ?? listEnv?.kind ?? 'main',
    runtimeName: threadedEnv?.runtimeName ?? listEnv?.runtimeName ?? 'main',
  };
}

// Synchronous entry point. The benchmark screen calls this directly to block
// the main runtime, and the runtime function below calls it on a worker.
export function runHeavyWorkloadSync(n: number): HeavyRunResult {
  const input = clampHeavyInput(n);
  const startedAt = Date.now();
  const result = recursiveFibonacci(input);
  return {
    n: input,
    result,
    durationMs: Date.now() - startedAt,
    ...runtimeInfo(),
  };
}

// Same workload, exposed as a runtime function so the caller can schedule it on
// a named secondary runtime with `call(heavyWorkload).on(runtimeName)(n)`.
export const heavyWorkload = runtimeFunction(
  (n: number): HeavyRunResult => runHeavyWorkloadSync(n),
);
