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
