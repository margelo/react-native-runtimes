import {
  ConfigPlugin,
  createRunOncePlugin,
  withGradleProperties,
  withMainApplication,
  withPlugins,
} from '@expo/config-plugins';
// codeMod utilities are not re-exported from the @expo/config-plugins index but are
// stable internal helpers used by many community plugins. Tested with >=9.0.0.
import { addImports } from '@expo/config-plugins/build/android/codeMod';

// ─── Android: gradle.properties ───────────────────────────────────────────────

const ANDROID_MIN_SDK = 24;

/**
 * Ensures `android.minSdkVersion` ≥ 24. Kept here so state can be used
 * independently of core in projects that only need shared state.
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
      gradle.modResults.push({ type: 'property', key, value: String(ANDROID_MIN_SDK) });
    }

    return gradle;
  });
};

// ─── Android: MainApplication.kt ──────────────────────────────────────────────

// State plugin only adds ThreadedZustandPackage.
// ThreadedRuntime and NitroModulesPackage are the responsibility of
// @react-native-runtimes/core plugin, which must run first.
const ANDROID_STATE_IMPORTS = ['com.nativecompose.threadedzustand.ThreadedZustandPackage'];

/**
 * Extends the `setExtraReactPackagesProvider` block that core's plugin inserted.
 *
 * Strategy 1 — `NitroModulesPackage(),` found inside the block (core ran first,
 *   the typical case): add `ThreadedZustandPackage(),` on the next line.
 *
 * Strategy 2 — `setExtraReactPackagesProvider` block exists but without
 *   `NitroModulesPackage` (user wrote a custom block): add
 *   `ThreadedZustandPackage()` as the first item in the existing `listOf(`.
 *
 * Strategy 3 — No `setExtraReactPackagesProvider` block at all: warn the user
 *   that core plugin must run first and skip. State plugin cannot create the
 *   block on its own because `ThreadedRuntime` lives in
 *   `@react-native-runtimes/core`.
 */
function addThreadedZustandToOnCreate(contents: string): string {
  // Strategy 1: NitroModulesPackage already in listOf — add after it.
  const nitroMatch = contents.match(/^([ \t]+)(NitroModulesPackage\(\),)/m);
  if (nitroMatch) {
    const indent = nitroMatch[1];
    return contents.replace(
      /^([ \t]+)(NitroModulesPackage\(\),)/m,
      `${indent}NitroModulesPackage(),\n${indent}ThreadedZustandPackage(),`,
    );
  }

  // Strategy 2: Provider block exists but no NitroModulesPackage — prepend to listOf.
  const providerIdx = contents.indexOf('setExtraReactPackagesProvider');
  if (providerIdx >= 0) {
    const listOfIdx = contents.indexOf('listOf(', providerIdx);
    if (listOfIdx >= 0) {
      const lineStart = contents.lastIndexOf('\n', listOfIdx) + 1;
      const listOfLineIndent =
        contents.slice(lineStart, listOfIdx).match(/^([ \t]+)/)?.[1] ?? '      ';
      const deepIndent = listOfLineIndent + '  ';
      const insertPos = listOfIdx + 'listOf('.length;
      return (
        contents.slice(0, insertPos) +
        `\n${deepIndent}ThreadedZustandPackage(),` +
        contents.slice(insertPos)
      );
    }
  }

  // Strategy 3: No provider block — state plugin cannot create one alone because
  // `ThreadedRuntime` is part of @react-native-runtimes/core. Warn and skip.
  // eslint-disable-next-line no-console
  console.warn(
    '[@react-native-runtimes/state] Could not find ' +
      'ThreadedRuntime.setExtraReactPackagesProvider in MainApplication.kt. ' +
      'Ensure @react-native-runtimes/core plugin runs before this one, or add ' +
      'ThreadedZustandPackage() to the provider list manually.',
  );
  return contents;
}

/**
 * Patches MainApplication.kt to include `ThreadedZustandPackage` in the
 * secondary runtime package list. Requires `@react-native-runtimes/core` plugin
 * to run first so that the `setExtraReactPackagesProvider` block exists and
 * `ThreadedRuntime` is already imported.
 */
const withAndroidMainApplicationState: ConfigPlugin = (config) => {
  return withMainApplication(config, (mod) => {
    const { language } = mod.modResults;
    let { contents } = mod.modResults;

    if (language !== 'kt') return mod;

    // Idempotency: ThreadedZustandPackage already registered.
    if (contents.includes('ThreadedZustandPackage')) {
      return mod;
    }

    contents = addImports(contents, ANDROID_STATE_IMPORTS, false);
    contents = addThreadedZustandToOnCreate(contents);

    mod.modResults.contents = contents;
    return mod;
  });
};

// ─── Plugin root ──────────────────────────────────────────────────────────────

/**
 * Expo Config Plugin for @react-native-runtimes/state.
 *
 * What it configures during `expo prebuild`:
 *
 * **Android — `gradle.properties`**
 * - `android.minSdkVersion` ≥ 24
 *
 * **Android — `MainApplication.kt`**
 * - Adds `ThreadedZustandPackage()` to the secondary runtime package list via
 *   `ThreadedRuntime.setExtraReactPackagesProvider`.
 *   Requires `@react-native-runtimes/core` plugin to run first — core is
 *   responsible for creating the provider block and importing `ThreadedRuntime`.
 *   When core has already inserted `NitroModulesPackage()`, state adds
 *   `ThreadedZustandPackage()` on the next line. When the block exists without
 *   `NitroModulesPackage`, `ThreadedZustandPackage()` is prepended to `listOf`.
 *
 * **iOS** — no additional setup needed; the Podspec and NitroModules autolinking
 * handle everything automatically.
 *
 * @example app.config.ts
 * ```ts
 * import type { ExpoConfig } from 'expo/config';
 * const config: ExpoConfig = {
 *   plugins: [
 *     '@react-native-runtimes/core',   // must come first
 *     '@react-native-runtimes/state',
 *   ],
 * };
 * export default config;
 * ```
 */
const withRuntimesState: ConfigPlugin = (config) =>
  withPlugins(config, [withAndroidMinSdk, withAndroidMainApplicationState]);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { name: string; version: string };

export default createRunOncePlugin(withRuntimesState, pkg.name, pkg.version);
