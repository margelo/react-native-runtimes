import * as fs from 'fs';
import * as path from 'path';
import {
  ConfigPlugin,
  createRunOncePlugin,
  withAppDelegate,
  withDangerousMod,
  withMainApplication,
  withPlugins,
} from '@expo/config-plugins';
// codeMod utilities are not re-exported from the @expo/config-plugins index but are
// stable internal helpers used by many community plugins. Tested with >=9.0.0.
import {
  addObjcImports,
  insertContentsInsideObjcFunctionBlock,
  insertContentsInsideSwiftFunctionBlock,
} from '@expo/config-plugins/build/ios/codeMod';
import {
  addImports,
  appendContentsInsideDeclarationBlock,
} from '@expo/config-plugins/build/android/codeMod';

// ─── Plugin options ────────────────────────────────────────────────────────────

/**
 * Options accepted by the `@react-native-runtimes/core` Expo Config Plugin.
 */
export interface CorePluginOptions {
  /**
   * npm package names whose native `ReactPackage` should be registered in the
   * secondary runtime. The package must declare its FQN in its `package.json`
   * under the `reactNativeRuntimes` field:
   *
   * ```json
   * {
   *   "reactNativeRuntimes": {
   *     "android": { "package": "com.example.MyPackage" }
   *   }
   * }
   * ```
   *
   * @example
   * ```ts
   * plugins: [
   *   ['@react-native-runtimes/core', {
   *     packages: ['@react-native-runtimes/state'],
   *   }],
   * ]
   * ```
   */
  packages?: string[];

  /**
   * Raw Android `ReactPackage` fully-qualified class names. Escape hatch for
   * first-party app packages or third-party libraries that don't ship a
   * `reactNativeRuntimes` metadata block in their `package.json`.
   *
   * @example
   * ```ts
   * plugins: [
   *   ['@react-native-runtimes/core', {
   *     androidPackages: ['com.mycompany.MyCustomPackage'],
   *   }],
   * ]
   * ```
   */
  androidPackages?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the simple class name from a fully-qualified Java/Kotlin class name. */
function getSimpleClassName(fqn: string): string {
  const lastDot = fqn.lastIndexOf('.');
  return lastDot >= 0 ? fqn.slice(lastDot + 1) : fqn;
}

interface RuntimesPackageMetadata {
  reactNativeRuntimes?: {
    android?: { package?: string };
  };
}

/**
 * Resolves an npm package name to its Android `ReactPackage` FQN by reading
 * the `reactNativeRuntimes.android.package` field from the package's
 * `package.json`. Throws a clear error if the package is not installed or
 * lacks the metadata block.
 */
function resolveAndroidFQN(pkgName: string): string {
  let pkgJson: RuntimesPackageMetadata;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pkgJson = require(`${pkgName}/package.json`) as RuntimesPackageMetadata;
  } catch {
    throw new Error(
      `[@react-native-runtimes/core] Could not resolve '${pkgName}/package.json'. ` +
        `Make sure '${pkgName}' is installed in your project.`,
    );
  }
  const fqn = pkgJson.reactNativeRuntimes?.android?.package;
  if (!fqn) {
    throw new Error(
      `[@react-native-runtimes/core] '${pkgName}' does not declare ` +
        '`reactNativeRuntimes.android.package` in its package.json. ' +
        'Ask the package author to add it, or list the FQN under `androidPackages` instead.',
    );
  }
  return fqn;
}

// ─── Expo config: New Architecture & Hermes ───────────────────────────────────

/**
 * Requires `newArchEnabled: true` in the Expo config. Nitro Modules — and thus
 * @react-native-runtimes/core — depend on New Architecture on both Android and
 * iOS. We fail loudly instead of silently flipping the flag because enabling
 * New Architecture has wide-reaching side effects (Fabric renderer, TurboModules,
 * different build pipeline) that the user should opt into explicitly.
 */
const withNewArchRequired: ConfigPlugin = (config) => {
  if (config.newArchEnabled !== true) {
    throw new Error(
      '[@react-native-runtimes/core] `newArchEnabled` must be set to `true` in your Expo config ' +
        '(app.json / app.config.ts). Nitro Modules require New Architecture on both Android and iOS.',
    );
  }
  return config;
};

/**
 * Requires Hermes as the JS engine. Secondary runtimes always instantiate
 * `HermesInstance` natively, so a JSC-only app would crash at runtime. We fail
 * at config-time rather than silently toggling the engine because switching
 * engines changes binary size, debugger behavior, and JS feature availability.
 */
const withHermesRequired: ConfigPlugin = (config) => {
  // `jsEngine` is deprecated in Expo (Hermes is the default) but still honored
  // when set, so we read it via a structural cast to catch lingering "jsc" overrides.
  type LegacyJsEngine = { jsEngine?: string };
  const checks: Array<[string, string | undefined]> = [
    ['jsEngine', (config as LegacyJsEngine).jsEngine],
    ['ios.jsEngine', (config.ios as LegacyJsEngine | undefined)?.jsEngine],
    ['android.jsEngine', (config.android as LegacyJsEngine | undefined)?.jsEngine],
  ];
  for (const [path, value] of checks) {
    if (value !== undefined && value !== 'hermes') {
      throw new Error(
        `[@react-native-runtimes/core] \`${path}\` is set to "${value}" in your Expo config, ` +
          'but secondary runtimes always use HermesInstance. Remove the override or set it to "hermes".',
      );
    }
  }
  return config;
};

// ─── Android: MainApplication.kt ──────────────────────────────────────────────

const ANDROID_RUNTIME_IMPORT = 'com.nativecompose.threadedruntime.ThreadedRuntime';
const ANDROID_NITRO_PACKAGE = 'com.margelo.nitro.NitroModulesPackage';

function buildCoreProviderBlock(lineIndent: string, packageFQNs: string[]): string {
  const innerIndent = lineIndent + '  ';
  const deepIndent = lineIndent + '    ';
  const packageLines = packageFQNs.map((fqn) => `${deepIndent}${getSimpleClassName(fqn)}(),`);
  return [
    `ThreadedRuntime.setExtraReactPackagesProvider {`,
    `${innerIndent}listOf(`,
    ...packageLines,
    `${innerIndent})`,
    `${lineIndent}}`,
  ].join('\n');
}

/**
 * Inserts `missingFQNs` into the `listOf(` of an existing
 * `setExtraReactPackagesProvider` block. Packages are prepended so the block
 * remains syntactically valid regardless of what is already inside. Already-
 * registered packages (detected by simple class name) are skipped.
 */
function addPackagesToExistingListOf(contents: string, missingFQNs: string[]): string {
  const providerIdx = contents.indexOf('setExtraReactPackagesProvider');
  if (providerIdx < 0) return contents;

  const listOfIdx = contents.indexOf('listOf(', providerIdx);
  if (listOfIdx < 0) return contents;

  const lineStart = contents.lastIndexOf('\n', listOfIdx) + 1;
  const listOfLineIndent =
    contents.slice(lineStart, listOfIdx).match(/^([ \t]+)/)?.[1] ?? '      ';
  const deepIndent = listOfLineIndent + '  ';
  const insertPos = listOfIdx + 'listOf('.length;

  const toInsert = missingFQNs
    .map((fqn) => `\n${deepIndent}${getSimpleClassName(fqn)}(),`)
    .join('');

  return contents.slice(0, insertPos) + toInsert + contents.slice(insertPos);
}

/**
 * Inserts a new `setExtraReactPackagesProvider` block inside `onCreate`,
 * before `loadReactNative(this)` when present, or at the tail of the method
 * as fallback.
 */
function insertCoreProviderInOnCreate(contents: string, packageFQNs: string[]): string {
  const match = contents.match(/^([ \t]+)loadReactNative\(this\)/m);
  if (match) {
    const lineIndent = match[1];
    const block = buildCoreProviderBlock(lineIndent, packageFQNs);
    return contents.replace(match[0], `${lineIndent}${block}\n${match[0]}`);
  }

  // Fallback: append inside onCreate (covers Expo templates using `load()`).
  return appendContentsInsideDeclarationBlock(
    contents,
    'fun onCreate',
    `\n    ${buildCoreProviderBlock('    ', packageFQNs)}\n  `,
  );
}

/**
 * Patches MainApplication.kt to register `NitroModulesPackage` and any extra
 * packages from {@link CorePluginOptions.packages} / {@link CorePluginOptions.androidPackages}
 * in the secondary runtime's package list via `setExtraReactPackagesProvider`.
 * Idempotent: packages already present in the file are never duplicated.
 *
 * Three cases are handled:
 * 1. All requested packages already present → skip entirely.
 * 2. `setExtraReactPackagesProvider` block exists but some packages are
 *    missing → extend the existing `listOf(`.
 * 3. No block present → insert the full provider block.
 */
const withAndroidMainApplicationCore: ConfigPlugin<CorePluginOptions> = (
  config,
  options = {},
) => {
  const { packages = [], androidPackages = [] } = options;
  // Resolve npm-name entries to FQNs via each package's reactNativeRuntimes
  // metadata, then merge with raw FQNs from androidPackages. Dedup so accidental
  // duplicates (e.g. same FQN listed twice or across both fields) don't
  // double-register a package.
  const resolvedFromMetadata = packages.map(resolveAndroidFQN);
  const packageFQNs = [
    ANDROID_NITRO_PACKAGE,
    ...new Set([...resolvedFromMetadata, ...androidPackages]),
  ];

  return withMainApplication(config, (mod) => {
    const { language } = mod.modResults;
    let { contents } = mod.modResults;

    if (language !== 'kt') return mod;

    // Idempotency: collect only the packages whose simple name is absent.
    const missingFQNs = packageFQNs.filter(
      (fqn) => !contents.includes(`${getSimpleClassName(fqn)}(`),
    );
    if (missingFQNs.length === 0) return mod;

    // Add any missing imports (runtime + missing packages). The runtime check
    // matches the full FQN so we don't get fooled by stray "ThreadedRuntime"
    // mentions in comments or unrelated code.
    const importsNeeded = [
      ...(contents.includes(ANDROID_RUNTIME_IMPORT) ? [] : [ANDROID_RUNTIME_IMPORT]),
      ...missingFQNs.filter((fqn) => !contents.includes(fqn)),
    ];
    if (importsNeeded.length > 0) {
      contents = addImports(contents, importsNeeded, false);
    }

    if (contents.includes('setExtraReactPackagesProvider')) {
      // Provider block already exists (e.g. the user wrote one manually) — add
      // only the missing packages to the existing listOf.
      contents = addPackagesToExistingListOf(contents, missingFQNs);
    } else {
      // No provider block at all — insert the full block.
      contents = insertCoreProviderInOnCreate(contents, packageFQNs);
    }

    mod.modResults.contents = contents;
    return mod;
  });
};

// ─── iOS: bridging header (forward-declare ThreadedRuntime) ────────────────────

const THREADED_RUNTIME_FORWARD_DECL = `
// Added by @react-native-runtimes/core. Forward-declare the ThreadedRuntime ObjC
// class so Swift can call +configure WITHOUT \`import NativeComposeThreadedRuntime\`.
// Importing that module would pull Nitro's C++ umbrella into the app target's
// Swift importer, which forces C++ interop and (on some RN versions) fails Clang
// modules verification. We only need the ObjC interface; the real class is linked
// from the pod at link time.
#import <Foundation/Foundation.h>

@interface ThreadedRuntime : NSObject
+ (void)configureWithReactNativeDelegate:(id)delegate
                           launchOptions:(nullable NSDictionary *)launchOptions;
@end
`;

/**
 * Ensures the app has a Swift bridging header containing a forward declaration of
 * `ThreadedRuntime`, and that `SWIFT_OBJC_BRIDGING_HEADER` points at it. This lets
 * the Swift AppDelegate call `ThreadedRuntime.configure(...)` without importing
 * the Nitro-backed module (see {@link withIosAppDelegateConfigure}).
 *
 * Done as a single dangerous mod (editing project.pbxproj text + writing the
 * header file) so both stay consistent regardless of mod ordering. Idempotent.
 */
const withIosBridgingHeader: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const iosRoot = cfg.modRequest.platformProjectRoot;
      const projectName = cfg.modRequest.projectName as string;
      const pbxPath = path.join(
        iosRoot,
        `${projectName}.xcodeproj`,
        'project.pbxproj',
      );
      let pbx = fs.readFileSync(pbxPath, 'utf8');

      // Use the existing bridging header if one is configured; otherwise add the
      // build setting (after each SWIFT_VERSION line) pointing at a standard path.
      const match = pbx.match(/SWIFT_OBJC_BRIDGING_HEADER = "?([^";\n]+)"?;/);
      let rel: string;
      if (match) {
        rel = match[1].replace(/^"|"$/g, '');
      } else {
        rel = `${projectName}/${projectName}-Bridging-Header.h`;
        pbx = pbx.replace(
          /(\bSWIFT_VERSION = [^;]+;)/g,
          `$1\n\t\t\t\tSWIFT_OBJC_BRIDGING_HEADER = "${rel}";`,
        );
        fs.writeFileSync(pbxPath, pbx);
      }

      const headerPath = path.join(iosRoot, rel);
      let contents = fs.existsSync(headerPath)
        ? fs.readFileSync(headerPath, 'utf8')
        : '//\n// Bridging header (generated by @react-native-runtimes/core).\n//\n';
      if (!contents.includes('@interface ThreadedRuntime')) {
        contents += THREADED_RUNTIME_FORWARD_DECL;
        fs.mkdirSync(path.dirname(headerPath), { recursive: true });
        fs.writeFileSync(headerPath, contents);
      }

      return cfg;
    },
  ]);

// ─── iOS: AppDelegate ─────────────────────────────────────────────────────────

/**
 * Patches the iOS AppDelegate to call
 * `ThreadedRuntime.configure(withReactNativeDelegate:launchOptions:)`.
 *
 * Swift path: inserts the call right after the React Native factory delegate is
 * set up (referencing that `delegate`, not `self`), relying on the forward
 * declaration from {@link withIosBridgingHeader} so the C++ module is never
 * imported into Swift. ObjC++ path: imports the module directly (C++ is fine in a
 * `.mm`). Idempotent.
 */
const withIosAppDelegateConfigure: ConfigPlugin = (config) => {
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
      // Remove a stray `import NativeComposeThreadedRuntime` if a previous version
      // of this plugin added one (it pulls C++ into Swift).
      contents = contents.replace(
        /^\s*import NativeComposeThreadedRuntime\s*\n/m,
        '',
      );
      const call =
        'ThreadedRuntime.configure(withReactNativeDelegate: delegate, launchOptions: launchOptions)';
      const anchor = 'delegate.dependencyProvider = RCTAppDependencyProvider()';
      if (contents.includes(anchor)) {
        contents = contents.replace(
          anchor,
          `${anchor}\n    // Configure secondary runtimes with the factory delegate.\n    ${call}`,
        );
      } else {
        // Fallback for templates without that exact anchor: head of the method
        // with `self` as the delegate.
        contents = insertContentsInsideSwiftFunctionBlock(
          contents,
          'application(_:didFinishLaunchingWithOptions:)',
          'ThreadedRuntime.configure(withReactNativeDelegate: self, launchOptions: launchOptions)',
          { position: 'head', indent: 4 },
        );
      }
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
 * What it validates/configures during `expo prebuild`:
 *
 * **Expo config — validation only (fails on mismatch)**
 * - `newArchEnabled` must be `true` — Nitro Modules require New Architecture.
 * - `jsEngine` (and the platform-specific overrides) must be `hermes` or unset —
 *   secondary runtimes always instantiate `HermesInstance` natively.
 *
 * **Android — `MainApplication.kt`**
 * - Adds `ThreadedRuntime.setExtraReactPackagesProvider { listOf(NitroModulesPackage()) }`
 *   before `loadReactNative(this)`. If a provider block already exists,
 *   `NitroModulesPackage()` is added to the existing `listOf` instead.
 *   Packages from {@link CorePluginOptions.packages} (resolved by npm name via
 *   `reactNativeRuntimes` metadata) and raw FQNs from
 *   {@link CorePluginOptions.androidPackages} are included alongside
 *   `NitroModulesPackage` — use this to register companion runtimes packages
 *   like `@react-native-runtimes/state` without an extra plugin.
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
 *   newArchEnabled: true,
 *   plugins: [
 *     ['@react-native-runtimes/core', {
 *       packages: ['@react-native-runtimes/state'],
 *       // androidPackages: ['com.mycompany.MyCustomPackage'], // optional raw FQN escape hatch
 *     }],
 *   ],
 * };
 * export default config;
 * ```
 */
const withRuntimesCore: ConfigPlugin<CorePluginOptions> = (config, options = {}) =>
  withPlugins(config, [
    withNewArchRequired,
    withHermesRequired,
    [withAndroidMainApplicationCore, options],
    withIosBridgingHeader,
    withIosAppDelegateConfigure,
  ]);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { name: string; version: string };

export default createRunOncePlugin(withRuntimesCore, pkg.name, pkg.version);
