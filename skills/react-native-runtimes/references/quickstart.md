# Quickstart

Installing `@react-native-runtimes/core` (and `@react-native-runtimes/state`) into an existing React Native app, end to end. Three setup pieces — Metro, `index.js`, native config — are all required. Skipping any of them produces confusing runtime errors, not build errors.

## 1. Install

```sh
npm install @react-native-runtimes/core @react-native-runtimes/state react-native-nitro-modules
cd ios && bundle exec pod install
```

`react-native-nitro-modules` is the JSI/codegen foundation both packages link against. `@react-native-runtimes/state` is optional if you only need rendering or runtime functions, but most apps want shared state to avoid pushing large props across the runtime boundary.

## 2. Metro config

The core package ships a Metro wrapper that scans your sources for `OnRuntime`, `threadedComponent`, `runtimeFunction`, and the function directives, then generates `.threaded-runtime/entry.js` — the entry the secondary runtimes load.

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withThreadedRuntime } = require('@react-native-runtimes/core/metro');

module.exports = withThreadedRuntime(
  mergeConfig(getDefaultConfig(__dirname), {}),
  {
    roots: ['App.tsx', 'src'],         // scan for OnRuntime / threadedComponent / runtimeFunction / directives
    generatedDir: '.threaded-runtime',
    generatedEntry: 'entry.js',
  },
);
```

Add the generated folder to `.gitignore`:

```
.threaded-runtime/
```

`roots` must cover every file that contains a threaded boundary. Anything Metro doesn't scan won't be registered, and the threaded surface will fail to find the component at runtime.

## 3. `index.js` — gate the threaded path

`index.js` is loaded by **every** runtime (main and threaded). Without the gate, the threaded runtime tries to register the main app and you get duplicate-registration errors or blank surfaces.

```js
// index.js
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

if (global.__THREADED_RUNTIME_ENV__) {
  // Threaded runtime path: load the generated registry only.
  // entry.js registers all threadedComponents and runtimeFunctions, then
  // calls AppRegistry.registerComponent('ThreadedRuntimeHost', () => ThreadedRuntimeHost).
  require('./.threaded-runtime/entry');
} else {
  AppRegistry.registerComponent(appName, () => App);
}
```

Either `global.__THREADED_RUNTIME_ENV__` or the legacy alias `global._is_it_a_list_env === true` is a reliable "I'm in a threaded runtime" check. Inside a threaded runtime, `global.__THREADED_RUNTIME_ENV__` is an object: `{ kind: string, runtimeName: string }`.

## 4. iOS — `AppDelegate.swift`

`ThreadedRuntime.configure(...)` tells the package which `RCTReactNativeFactoryDelegate` to copy native modules from when it creates a secondary `RCTHost`. **It must run before the first surface mounts**, so put it in `application(_:didFinishLaunchingWithOptions:)` right after your normal RN setup.

```swift
import UIKit
import React
import React_RCTAppDelegate
import NativeComposeThreadedRuntime

@main
class AppDelegate: RCTAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    self.moduleName = "YourAppName"
    self.initialProps = [:]

    ThreadedRuntime.configure(
      withReactNativeDelegate: self,
      launchOptions: launchOptions
    )

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
```

If your delegate is a separate `ReactNativeDelegate` object rather than `AppDelegate` itself, pass that object instead of `self`.

Optional: prewarm a runtime at launch.

```swift
ThreadedRuntime.prewarmRuntime("background")
```

## 5. Android — `MainApplication.kt`

Autolinking installs native modules into the **main** runtime only. Threaded runtimes only see what the package providers return.

```kotlin
package com.yourapp

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.soloader.SoLoader
import com.nativecompose.threadedruntime.ThreadedRuntime

class MainApplication : Application(), ReactApplication {
  // ...your existing ReactNativeHost + reactHost...

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, /* mergedSoMapping per your RN template */)

    // Easiest correct default: give threaded runtimes the same packages as main.
    ThreadedRuntime.setMainReactPackagesProvider {
      PackageList(this).packages
    }

    // If you'd rather curate a smaller list, use setExtraReactPackagesProvider instead:
    // ThreadedRuntime.setExtraReactPackagesProvider {
    //   listOf(NitroModulesPackage(), ThreadedZustandPackage(), /* screen-specific packages */)
    // }

    load() // new architecture entry point
    // Optional prewarm:
    // ThreadedRuntime.prewarmRuntime(applicationContext, "background")
  }
}
```

Symptom of skipping this step: native module calls from the threaded runtime return `undefined` or throw "module not found"; the main app still works.

For a long-lived business runtime that should mirror the main runtime's module set, use `setMainReactPackagesProvider` + `prewarmBusinessRuntime("name")`. That runtime receives `global.__THREADED_RUNTIME_ENV__.kind === "business-runtime"` so you can gate startup code.

## 6. Mount something on a runtime — minimal example

Most consumers should wrap a top-level component in `OnRuntime` (Metro generates the registration) or use `<ThreadedScreen>` for a full route.

```tsx
import { ThreadedScreen, threadedComponent } from '@react-native-runtimes/core';

type ConversationScreenProps = { conversationId: string };

function ConversationRoute({ conversationId }: ConversationScreenProps) {
  return <ConversationContent conversationId={conversationId} />;
}

// `threadedComponent` gives the component a stable name the threaded surface looks up.
export const ConversationScreen = threadedComponent<ConversationScreenProps>(
  'ConversationScreen',
  ConversationRoute,
);

// In your navigator (stays on the main runtime; just hosts the native surface).
export function ConversationContainer({ conversationId }: { conversationId: string }) {
  return (
    <ThreadedScreen
      component={ConversationScreen}
      props={{ conversationId }}
      runtimeName={`conversation-${conversationId}-runtime`}
    />
  );
}
```

`ThreadedScreen` renders flex:1, preloads its runtime, and keeps it alive when the screen unmounts. For a single sub-component (not a whole route), use `<OnRuntime name="...">{<Component />}</OnRuntime>` instead. See [rendering-components.md](rendering-components.md) for the full surface.

## Quick verification checklist

- `npx react-native start --reset-cache` once after wiring Metro, so `.threaded-runtime/entry.js` regenerates.
- Open Hermes Inspector / Chrome DevTools — each named runtime appears as a separate target. If you only see one when a threaded surface is mounted, the runtime isn't starting; check the gate in `index.js`.
- A blank threaded surface usually means: (a) the component name doesn't match, (b) the component file isn't under `roots`, or (c) `index.js` is registering the main app inside the threaded runtime.

## Next steps

- Render more than one component → [rendering-components.md](rendering-components.md)
- Return a value from work on another runtime → [runtime-functions.md](runtime-functions.md)
- Background tasks, prewarm, native dispatch → [headless-and-lifecycle.md](headless-and-lifecycle.md)
- Sync state across runtimes → [shared-state.md](shared-state.md)
