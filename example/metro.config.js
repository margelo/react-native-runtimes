const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withThreadedRuntime } = require('@react-native-runtimes/core/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [path.resolve(__dirname, '..')],
};

module.exports = withThreadedRuntime(
  mergeConfig(getDefaultConfig(__dirname), config),
  {
    roots: ['App.tsx', 'src'],
  },
);
