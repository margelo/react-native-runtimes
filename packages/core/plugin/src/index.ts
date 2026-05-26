import {
  ConfigPlugin,
  createRunOncePlugin,
  withAppDelegate,
  withGradleProperties,
  withMainApplication,
  withPlugins,
} from '@expo/config-plugins';
// codeMod utilities are not re-exported from the @expo/config-plugins index but are
// stable internal helpers used by many community plugins. Tested with >=9.0.0.
import {
  addObjcImports,
  addSwiftImports,
  insertContentsInsideObjcFunctionBlock,
  insertContentsInsideSwiftFunctionBlock,
} from '@expo/config-plugins/build/ios/codeMod';
import {
  addImports,
  appendContentsInsideDeclarationBlock,
} from '@expo/config-plugins/build/android/codeMod';

// ─── Expo config: New Architecture ────────────────────────────────────────────

/**
 * Sets `newArchEnabled: true` at the Expo config level so that `expo prebuild`
 * enables New Architecture on both Android and iOS. Nitro Modules require New
 * Architecture — without this, the Nitro fast path will not be available on iOS
 * even if `gradle.properties` is patched for Android.
 */
const withNewArchEnabled: ConfigPlugin = (config) => {
  if (config.newArchEnabled !== true) {
    // eslint-disable-next-line no-console
    console.warn(
      '[@react-native-runtimes/core] newArchEnabled set to true ' +
        '(required for Nitro Modules on both Android and iOS).',
    );
    config.newArchEnabled = true;
  }
  return config;
};

// ─── Android: gradle.properties ───────────────────────────────────────────────

const ANDROID_MIN_SDK = 24;

/**
 * Enforces Android build flags required by @react-native-runtimes/core:
 * - `android.minSdkVersion` ≥ 24 (JVM threading APIs)
 * - `newArchEnabled=true`  (mirrored from Expo config; kept explicit for
 *                           projects that skip the Expo config mod pipeline)
 * - `hermesEnabled=true`   (secondary runtimes always use HermesInstance)
 */
const withAndroidGradleProperties: ConfigPlugin = (config) => {
  return withGradleProperties(config, (gradle) => {
    const flags: Array<{ key: string; value: string; minNumeric?: number }> = [
      { key: 'android.minSdkVersion', value: String(ANDROID_MIN_SDK), minNumeric: ANDROID_MIN_SDK },
      { key: 'newArchEnabled', value: 'true' },
      { key: 'hermesEnabled', value: 'true' },
    ];

    for (const { key, value, minNumeric } of flags) {
      const prop = gradle.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );

      if (prop?.type === 'property') {
        if (minNumeric !== undefined) {
          const current = parseInt(prop.value ?? '0', 10);
          if (current < minNumeric) {
            // eslint-disable-next-line no-console
            console.warn(`[@react-native-runtimes/core] ${key} bumped from ${current} → ${value}`);
            prop.value = value;
          }
        } else if (prop.value !== value) {
          // eslint-disable-next-line no-console
          console.warn(
            `[@react-native-runtimes/core] ${key} set to ${value} (required for threaded runtime)`,
          );
          prop.value = value;
        }
      } else {
        gradle.modResults.push({ type: 'property', key, value });
      }
    }

    return gradle;
  });
};

// ─── Android: MainApplication.kt ──────────────────────────────────────────────

const ANDROID_CORE_IMPORTS = [
  'com.nativecompose.threadedruntime.ThreadedRuntime',
  'com.margelo.nitro.NitroModulesPackage',
];

function buildCoreProviderBlock(lineIndent: string): string {
  const innerIndent = lineIndent + '  ';
  const deepIndent = lineIndent + '    ';
  return [
    `ThreadedRuntime.setExtraReactPackagesProvider {`,
    `${innerIndent}listOf(`,
    `${deepIndent}NitroModulesPackage(),`,
    `${innerIndent})`,
    `${lineIndent}}`,
  ].join('\n');
}

/**
 * `setExtraReactPackagesProvider` already exists (e.g. user has custom
 * packages, or state plugin ran first) but `NitroModulesPackage` is missing.
 * Insert it as the first item in the existing `listOf(`.
 */
function addNitroModulesPackageToExistingBlock(contents: string): string {
  const providerIdx = contents.indexOf('setExtraReactPackagesProvider');
  if (providerIdx < 0) return contents;

  const listOfIdx = contents.indexOf('listOf(', providerIdx);
  if (listOfIdx < 0) return contents;

  // Determine item indentation from the listOf line + 2 spaces.
  const lineStart = contents.lastIndexOf('\n', listOfIdx) + 1;
  const listOfLineIndent =
    contents.slice(lineStart, listOfIdx).match(/^([ \t]+)/)?.[1] ?? '      ';
  const deepIndent = listOfLineIndent + '  ';
  const insertPos = listOfIdx + 'listOf('.length;

  return (
    contents.slice(0, insertPos) +
    `\n${deepIndent}NitroModulesPackage(),` +
    contents.slice(insertPos)
  );
}

/**
 * Inserts a new `setExtraReactPackagesProvider` block containing
 * `NitroModulesPackage()` inside `onCreate`, before `loadReactNative(this)`
 * when present, or at the tail of the method as fallback.
 */
function insertCoreProviderInOnCreate(contents: string): string {
  const match = contents.match(/^([ \t]+)loadReactNative\(this\)/m);
  if (match) {
    const lineIndent = match[1];
    const block = buildCoreProviderBlock(lineIndent);
    return contents.replace(match[0], `${lineIndent}${block}\n${match[0]}`);
  }

  // Fallback: append inside onCreate (covers Expo templates using `load()`).
  return appendContentsInsideDeclarationBlock(
    contents,
    'fun onCreate',
    `\n    ${buildCoreProviderBlock('    ')}\n  `,
  );
}

/**
 * Patches MainApplication.kt to register `NitroModulesPackage` in the
 * secondary runtime's package list via `setExtraReactPackagesProvider`.
 *
 * Three cases are handled:
 * 1. `NitroModulesPackage` already present → skip (idempotent).
 * 2. `setExtraReactPackagesProvider` block exists but without
 *    `NitroModulesPackage` → extend the existing `listOf(`.
 * 3. Neither present → insert the full provider block.
 */
const withAndroidMainApplicationCore: ConfigPlugin = (config) => {
  return withMainApplication(config, (mod) => {
    const { language } = mod.modResults;
    let { contents } = mod.modResults;

    if (language !== 'kt') return mod;

    // Idempotency: NitroModulesPackage is already registered.
    if (contents.includes('NitroModulesPackage')) {
      return mod;
    }

    contents = addImports(contents, ANDROID_CORE_IMPORTS, false);

    if (contents.includes('setExtraReactPackagesProvider')) {
      // Provider block exists (user or state plugin added one) but Nitro is
      // missing — add NitroModulesPackage to the existing listOf.
      contents = addNitroModulesPackageToExistingBlock(contents);
    } else {
      // No provider block at all — insert the full block.
      contents = insertCoreProviderInOnCreate(contents);
    }

    mod.modResults.contents = contents;
    return mod;
  });
};

// ─── iOS: AppDelegate ─────────────────────────────────────────────────────────

/**
 * Patches the iOS AppDelegate to call
 * `ThreadedRuntime.configure(withReactNativeDelegate:launchOptions:)` at the
 * start of `application(_:didFinishLaunchingWithOptions:)`.
 *
 * This call is mandatory: the native implementation calls `RCTFatal` if any
 * threaded runtime is created before the delegate is configured. Supports both
 * Swift (AppDelegate.swift) and Objective-C (AppDelegate.mm). Idempotent.
 */
const withIosThreadedRuntimeConfigure: ConfigPlugin = (config) => {
  return withAppDelegate(config, (mod) => {
    const { language } = mod.modResults;
    let { contents } = mod.modResults;

    if (
      contents.includes('ThreadedRuntime.configure') ||
      contents.includes('configureWithReactNativeDelegate')
    ) {
      return mod;
    }

    if (language === 'swift') {
      contents = addSwiftImports(contents, ['NativeComposeThreadedRuntime']);
      contents = insertContentsInsideSwiftFunctionBlock(
        contents,
        'application(_:didFinishLaunchingWithOptions:)',
        'ThreadedRuntime.configure(withReactNativeDelegate: self, launchOptions: launchOptions)',
        { position: 'head', indent: 4 },
      );
    } else if (language === 'objc' || language === 'objcpp') {
      contents = addObjcImports(contents, [
        '<NativeComposeThreadedRuntime/ThreadedRuntime.h>',
      ]);
      contents = insertContentsInsideObjcFunctionBlock(
        contents,
        'application:didFinishLaunchingWithOptions:',
        '[ThreadedRuntime configureWithReactNativeDelegate:self launchOptions:launchOptions];',
        { position: 'head', indent: 2 },
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
};

// ─── Plugin root ──────────────────────────────────────────────────────────────

/**
 * Expo Config Plugin for @react-native-runtimes/core.
 *
 * What it configures during `expo prebuild`:
 *
 * **Expo config**
 * - `newArchEnabled: true` — enables New Architecture on both Android and iOS.
 *   Nitro Modules require New Architecture.
 *
 * **Android — `gradle.properties`**
 * - `android.minSdkVersion` ≥ 24
 * - `newArchEnabled=true` (mirrored; ensures Android is set even in non-standard
 *   prebuild pipelines)
 * - `hermesEnabled=true` (secondary runtimes always use HermesInstance)
 *
 * **Android — `MainApplication.kt`**
 * - Adds `ThreadedRuntime.setExtraReactPackagesProvider { listOf(NitroModulesPackage()) }`
 *   before `loadReactNative(this)`. If a provider block already exists,
 *   `NitroModulesPackage()` is added to the existing `listOf` instead.
 *
 * **iOS — AppDelegate**
 * - Adds `import NativeComposeThreadedRuntime` and calls
 *   `ThreadedRuntime.configure(withReactNativeDelegate:launchOptions:)` at the
 *   head of `application(_:didFinishLaunchingWithOptions:)`. Required — the
 *   native code calls `RCTFatal` without this. Supports Swift and ObjC.
 *
 * @example app.config.ts
 * ```ts
 * import type { ExpoConfig } from 'expo/config';
 * const config: ExpoConfig = {
 *   plugins: ['@react-native-runtimes/core'],
 * };
 * export default config;
 * ```
 */
const withRuntimesCore: ConfigPlugin = (config) =>
  withPlugins(config, [
    withNewArchEnabled,
    withAndroidGradleProperties,
    withAndroidMainApplicationCore,
    withIosThreadedRuntimeConfigure,
  ]);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { name: string; version: string };

export default createRunOncePlugin(withRuntimesCore, pkg.name, pkg.version);
