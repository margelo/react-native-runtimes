/**
 * @format
 */

const { AppRegistry } = require('react-native');

// Register threaded roots/callable modules in every runtime. Component modules
// stay lazy; production runtime-specific entries are gated inside the generated
// entry once the native runtime prelude is available.
require('./.threaded-runtime/entry');

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  // Android debug loads secondary runtimes from Metro before the native prelude
  // runs, so app-specific runtime entry files need an explicit dev fallback.
  require('./index.business-runtime');
}

const threadedRuntimeEnv = global.__THREADED_RUNTIME_ENV__;
const isListEnvironment =
  global._is_it_a_list_env === true && global.__COMPOSE_CHAT_LIST_ENV__;

if (threadedRuntimeEnv || isListEnvironment) {
  if (threadedRuntimeEnv?.kind !== 'business-runtime') {
    AppRegistry.registerComponent(
      'ComposeChatSecondRuntimeRnList',
      () => require('./App').SecondRuntimeRnListApp,
    );
  }
}

const { name: appName } = require('./app.json');
AppRegistry.registerComponent(appName, () => require('./App').default);
