import {
  getCurrentRuntime,
  runtimeFunction,
} from '@react-native-runtimes/core';

// These fixtures are scanned by the @react-native-runtimes/core Metro plugin
// and registered in EVERY runtime (main + workers) via the generated
// .threaded-runtime/entry.js. The harness tests use them to verify that
// runOn() actually dispatches into the worker and that the runtime-detection
// API reports correctly inside each runtime.

export const whoAmI = runtimeFunction.named(
  'harness/runtime-introspection.whoAmI',
  () => {
    const info = getCurrentRuntime();
    return {
      isMain: info.isMain,
      name: info.name,
      kind: info.kind,
    };
  },
);

export const echo = runtimeFunction.named(
  'harness/runtime-introspection.echo',
  (value: string) => `${value}:from:${getCurrentRuntime().name}`,
);

export const addOnRuntime = runtimeFunction.named(
  'harness/runtime-introspection.addOnRuntime',
  (a: number, b: number) => ({
    sum: a + b,
    runtime: getCurrentRuntime().name,
  }),
);

export const throwOnRuntime = runtimeFunction.named(
  'harness/runtime-introspection.throwOnRuntime',
  (message: string) => {
    throw new Error(`thrown on ${getCurrentRuntime().name}: ${message}`);
  },
);

// Regression fixture: JS timers on a worker runtime. Timers only run once the
// worker's ReactHost is resumed (JavaTimerManager starts paused); before the
// null-Activity resume fix this promise never settled, which also hung
// whatwg-fetch responses and any retry backoff running on a worker.
export const timerOnRuntime = runtimeFunction.named(
  'harness/runtime-introspection.timerOnRuntime',
  async (delayMs: number) => {
    const startedAt = Date.now();
    await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    return {
      elapsedMs: Date.now() - startedAt,
      runtime: getCurrentRuntime().name,
    };
  },
);

// Regression fixture: dispatch to 'main' must reach the app's real main
// runtime (where this module's state lives), not a freshly spawned runtime
// that happens to be named "main". The marker is module-scope, so only the
// runtime that called setMainMarker can read it back.
let mainMarker: string | null = null;

export const setMainMarker = (value: string) => {
  mainMarker = value;
};

export const readMainMarker = runtimeFunction.named(
  'harness/runtime-introspection.readMainMarker',
  () => ({
    marker: mainMarker,
    runtime: getCurrentRuntime().name,
    isMain: getCurrentRuntime().isMain,
  }),
);

// Worker→main round trip (the "token bridge" pattern): runs on a worker and
// from there dispatches readMainMarker to 'main'.
export const readMainMarkerViaWorker = runtimeFunction.named(
  'harness/runtime-introspection.readMainMarkerViaWorker',
  async () => {
    const fromMain = await readMainMarker.runOn('main');
    return {
      workerRuntime: getCurrentRuntime().name,
      ...fromMain,
    };
  },
);
