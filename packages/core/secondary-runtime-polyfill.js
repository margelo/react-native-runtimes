// Polyfill loaded before every module in every runtime (main + secondary).
//
// Expo installs its `global.expo` JSI host object only on the MAIN React Native
// runtime. Secondary "threaded" runtimes created by this library don't get it,
// so any module that reads `globalThis.expo.<member>` at load time — notably
// expo-modules-core's EventEmitter (`var EventEmitter = globalThis.expo.EventEmitter`)
// and `requireNativeModule(...)` — throws and crashes the secondary runtime
// before the threaded entry runs.
//
// Only stub inside secondary runtimes, detected via the env global that is
// always injected BEFORE the bundle evaluates (iOS: JSI in
// didInitializeRuntime; Android: the bundle-loader prelude). A bare
// `typeof globalThis.expo === 'undefined'` guard is not enough: on Android
// bridgeless the MAIN runtime's native `global.expo` host installs after
// bundle start, so the stub would win that race and mask the real host —
// every expo-modules sync call then returns undefined through the stub Proxy
// and Expo apps die at boot (e.g. expo-localization getLocales()). On bare
// React Native (no Expo in the bundle) this is inert either way.
if (
  typeof globalThis.__THREADED_RUNTIME_ENV__ !== 'undefined' &&
  typeof globalThis.expo === 'undefined'
) {
  var NoopClass = function () {};
  NoopClass.prototype.addListener = function () {
    return { remove: function () {} };
  };
  NoopClass.prototype.removeListener = function () {};
  NoopClass.prototype.removeAllListeners = function () {};
  NoopClass.prototype.emit = function () {};

  var moduleStub = new Proxy(
    {},
    {
      get: function () {
        return function () {};
      },
    },
  );

  globalThis.expo = {
    EventEmitter: NoopClass,
    NativeModule: NoopClass,
    SharedObject: NoopClass,
    SharedRef: NoopClass,
    modules: new Proxy(
      {},
      {
        get: function () {
          return moduleStub;
        },
        has: function () {
          return true;
        },
      },
    ),
  };
}
