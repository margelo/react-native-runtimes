import {
  ConfigPlugin,
  createRunOncePlugin,
  withGradleProperties,
  withPlugins,
} from '@expo/config-plugins';

const ANDROID_MIN_SDK = 24;

/**
 * Bumps android.minSdkVersion in gradle.properties to at least 24.
 * @react-native-runtimes/state relies on the threaded runtime bridge
 * which requires API level 24+.
 */
const withAndroidMinSdk: ConfigPlugin = (config) => {
  return withGradleProperties(config, (gradle) => {
    const key = 'android.minSdkVersion';

    const prop = gradle.modResults.find(
      (item) => item.type === 'property' && item.key === key,
    );

    if (prop?.type === 'property') {
      const current = parseInt(prop.value ?? '0', 10);
      if (current < ANDROID_MIN_SDK) {
        // eslint-disable-next-line no-console
        console.warn(
          `[@react-native-runtimes/state] android.minSdkVersion bumped ` +
            `from ${current} → ${ANDROID_MIN_SDK} (minimum required for shared zustand store).`,
        );
        prop.value = String(ANDROID_MIN_SDK);
      }
    } else {
      gradle.modResults.push({
        type: 'property',
        key,
        value: String(ANDROID_MIN_SDK),
      });
    }

    return gradle;
  });
};

/**
 * Expo Config Plugin for @react-native-runtimes/state.
 *
 * What it configures:
 * - **Android**: ensures `android.minSdkVersion` ≥ 24 in `gradle.properties`.
 * - **iOS**: no additional setup needed — the Podspec and NitroModules
 *   autolinking handle everything automatically.
 *
 * @example app.config.ts
 * ```ts
 * import type { ExpoConfig } from 'expo/config';
 * const config: ExpoConfig = {
 *   plugins: [
 *     '@react-native-runtimes/core',
 *     '@react-native-runtimes/state',
 *   ],
 * };
 * export default config;
 * ```
 */
const withRuntimesState: ConfigPlugin = (config) =>
  withPlugins(config, [withAndroidMinSdk]);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { name: string; version: string };

export default createRunOncePlugin(withRuntimesState, pkg.name, pkg.version);
