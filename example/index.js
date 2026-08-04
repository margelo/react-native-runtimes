/**
 * @format
 */

const { AppRegistry } = require('react-native');
const {
  getCurrentRuntime,
  isMainRuntime,
} = require('@react-native-runtimes/core');

// Register threaded roots/callable modules in every runtime. Component modules
// stay lazy; runtime-specific entries are gated inside the generated entry via
// __THREADED_RUNTIME_ENV__, which native injects before any script evaluates.
// (Android debug workers bundle the generated entry directly, so this file
// only runs on the main runtime there; release workers evaluate it via the
// embedded app bundle.)
require('./.threaded-runtime/entry');

const currentRuntime = getCurrentRuntime();

if (!isMainRuntime() && currentRuntime.kind !== 'business-runtime') {
  AppRegistry.registerComponent(
    'ComposeChatSecondRuntimeRnList',
    () => require('./App').SecondRuntimeRnListApp,
  );
}

const { name: appName } = require('./app.json');
AppRegistry.registerComponent(appName, () => require('./App').default);
