/**
 * @format
 */

const { AppRegistry } = require('react-native');
const {
  getCurrentRuntime,
  isMainRuntime,
} = require('@react-native-runtimes/core');

// Register threaded roots/callable modules in every runtime. Component modules
// stay lazy; production runtime-specific entries are gated inside the generated
// entry once the native runtime prelude is available.
require('./.threaded-runtime/entry');

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  // Android debug loads secondary runtimes from Metro before the native prelude
  // runs, so app-specific runtime entry files need an explicit dev fallback.
  require('./index.business-runtime');
}

const currentRuntime = getCurrentRuntime();

if (!isMainRuntime() && currentRuntime.kind !== 'business-runtime') {
  AppRegistry.registerComponent(
    'ComposeChatSecondRuntimeRnList',
    () => require('./App').SecondRuntimeRnListApp,
  );
}

const { name: appName } = require('./app.json');
AppRegistry.registerComponent(appName, () => require('./App').default);
