// Polyfill loaded before every module in every runtime (main + secondary).
//
// Expo installs its `global.expo` JSI host object only on the MAIN React Native
// runtime. Secondary "threaded" runtimes created by this library don't get it,
// so any module that reads `globalThis.expo.<member>` at load time — notably
// expo-modules-core's EventEmitter (`var EventEmitter = globalThis.expo.EventEmitter`)
// and `requireNativeModule(...)` — throws and crashes the secondary runtime
// before the threaded entry runs.
//
// On the main runtime the native host is already installed by the time polyfills
// evaluate, so the `typeof ... undefined` guard leaves it untouched. On a
// secondary runtime it's absent, so we install a minimal stub. On bare React
// Native (no Expo in the bundle) this is inert.
if (typeof globalThis.expo === 'undefined') {
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
