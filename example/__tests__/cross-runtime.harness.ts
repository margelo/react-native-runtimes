// Cross-runtime dispatch, on-device via react-native-harness.
//
// Two things make this suite work in dev mode; both live in
// @react-native-runtimes/core (Android):
//   - __THREADED_RUNTIME_ENV__ is injected into every worker's jsi::Runtime
//     by a BindingsInstaller before any script evaluates, so the runtime gate
//     works no matter where the bundle came from (issue #35).
//   - Debug workers bundle the generated worker entry
//     (.threaded-runtime/entry) instead of the app entry. Under the harness
//     this matters twice over: the harness's Metro substitutes the app entry
//     (./index.js) with its own runner, so a worker fetching index.bundle
//     would evaluate the harness program and never register
//     ThreadedRuntimeFunctionRunner (the old "n = 7 callable modules" bridge
//     timeout).
//
// The entry import below mirrors on the harness-driven MAIN runtime what the
// app entry normally registers: without it, dispatch-to-main has no runtime
// functions registered on main, because the harness runner replaces the app's
// index.js there.
import '../.threaded-runtime/entry';
import { beforeAll, describe, expect, it } from 'react-native-harness';
import {
  getCurrentRuntime,
  ThreadedRuntime,
} from '@react-native-runtimes/core';
import {
  addOnRuntime,
  echo,
  readMainMarkerViaWorker,
  setMainMarker,
  throwOnRuntime,
  timerOnRuntime,
  whoAmI,
} from '../src/harness-fixtures/runtime-introspection';

const BUSINESS_RUNTIME = 'business-runtime';

describe('cross-runtime dispatch via runOn()', () => {
  beforeAll(async () => {
    // Spin up the business runtime once. preload is idempotent — repeated
    // calls return the same warm runtime.
    await ThreadedRuntime.prewarmBusinessRuntime(BUSINESS_RUNTIME);
  });

  it('main runtime self-reports as main before any dispatch', () => {
    expect(getCurrentRuntime().isMain).toBe(true);
    expect(getCurrentRuntime().name).toBe('main');
  });

  it('whoAmI.runOn(BUSINESS_RUNTIME) reports the worker, not main', async () => {
    const result = await whoAmI.runOn(BUSINESS_RUNTIME);
    expect(result.isMain).toBe(false);
    expect(result.name).toBe(BUSINESS_RUNTIME);
    expect(result.kind).toBe('business-runtime');
  });

  it('echo.runOn round-trips arguments and stamps the worker name', async () => {
    const result = await echo.runOn(BUSINESS_RUNTIME, 'hello');
    expect(result).toBe(`hello:from:${BUSINESS_RUNTIME}`);
  });

  it('addOnRuntime returns a struct that proves execution happened on worker', async () => {
    const result = await addOnRuntime.runOn(BUSINESS_RUNTIME, 7, 35);
    expect(result.sum).toBe(42);
    expect(result.runtime).toBe(BUSINESS_RUNTIME);
  });

  it('thrown errors on the worker reject the main-side promise', async () => {
    await expect(
      throwOnRuntime.runOn(BUSINESS_RUNTIME, 'kaboom'),
    ).rejects.toThrow(/thrown on business-runtime: kaboom/);
  });

  it('dispatching the same function twice does not leak state across calls', async () => {
    const first = await echo.runOn(BUSINESS_RUNTIME, 'a');
    const second = await echo.runOn(BUSINESS_RUNTIME, 'b');
    expect(first).toBe(`a:from:${BUSINESS_RUNTIME}`);
    expect(second).toBe(`b:from:${BUSINESS_RUNTIME}`);
  });

  // Regression: worker hosts used to stay paused without an Activity, so
  // JavaTimerManager never fired and every JS timer on a worker hung forever
  // (including whatwg-fetch's response dispatch).
  it('JS timers fire on the worker', async () => {
    const result = await timerOnRuntime.runOn(BUSINESS_RUNTIME, 50);
    expect(result.runtime).toBe(BUSINESS_RUNTIME);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(40);
  });

  // Regression: dispatch to 'main' used to spawn a fresh runtime that merely
  // happened to be named "main", so main-owned module state was missing and
  // calls "succeeded" against the wrong runtime. The marker is module-scope
  // state only the real main runtime holds.
  it("dispatch to 'main' from a worker reaches the real main runtime", async () => {
    setMainMarker('cross-runtime-token');
    const result = await readMainMarkerViaWorker.runOn(BUSINESS_RUNTIME);
    expect(result.workerRuntime).toBe(BUSINESS_RUNTIME);
    expect(result.isMain).toBe(true);
    expect(result.marker).toBe('cross-runtime-token');
  });

  it('main runtime is unaffected after the worker runs', () => {
    expect(getCurrentRuntime().isMain).toBe(true);
    expect(getCurrentRuntime().name).toBe('main');
  });
});
