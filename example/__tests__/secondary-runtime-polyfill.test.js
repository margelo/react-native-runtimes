const fs = require('fs');
const path = require('path');

const POLYFILL_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../packages/core/secondary-runtime-polyfill.js'),
  'utf8',
);

const runPolyfill = () => new Function(POLYFILL_SOURCE)();

// The polyfill must only stub `global.expo` on secondary runtimes (detected
// via __THREADED_RUNTIME_ENV__, which native injects before the bundle
// evaluates). On the MAIN runtime the stub must never install: on Android
// bridgeless the real expo host installs AFTER bundle start, so an
// unconditional "stub when undefined" guard used to win that race and mask
// the real host — every expo-modules sync call then returned undefined.
describe('secondary-runtime-polyfill expo stub', () => {
  afterEach(() => {
    delete globalThis.expo;
    delete globalThis.__THREADED_RUNTIME_ENV__;
  });

  it('does NOT stub on the main runtime (no env global), even without expo', () => {
    runPolyfill();
    expect(globalThis.expo).toBeUndefined();
  });

  it('stubs on a secondary runtime when expo is absent', () => {
    globalThis.__THREADED_RUNTIME_ENV__ = {
      kind: 'threaded-runtime',
      runtimeName: 'worker',
    };
    runPolyfill();
    expect(globalThis.expo).toBeDefined();
    // Stub shape: module lookups succeed and members are callable no-ops, so
    // expo-modules-core's load-time reads don't crash the worker.
    expect('AnyModule' in globalThis.expo.modules).toBe(true);
    expect(() => globalThis.expo.modules.AnyModule.anyMethod()).not.toThrow();
    const emitter = new globalThis.expo.EventEmitter();
    expect(() => emitter.addListener('event', () => {}).remove()).not.toThrow();
  });

  it('leaves a pre-existing real expo host untouched on a secondary runtime', () => {
    globalThis.__THREADED_RUNTIME_ENV__ = {
      kind: 'threaded-runtime',
      runtimeName: 'worker',
    };
    const realHost = { modules: { RealModule: {} } };
    globalThis.expo = realHost;
    runPolyfill();
    expect(globalThis.expo).toBe(realHost);
  });

  it('leaves the main runtime untouched when the real host is already installed', () => {
    const realHost = { modules: {} };
    globalThis.expo = realHost;
    runPolyfill();
    expect(globalThis.expo).toBe(realHost);
  });
});
