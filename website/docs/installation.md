---
id: installation
title: Installation
---

Install the runtime and shared store packages:

```sh
npm install @react-native-runtimes/core @react-native-runtimes/state react-native-nitro-modules
```

For local development in this repository the app uses file dependencies:

```json
{
  "dependencies": {
    "@react-native-runtimes/core": "file:packages/core",
    "@react-native-runtimes/state": "file:packages/state"
  }
}
```

## iOS

Install pods after adding the packages:

```sh
cd ios
bundle exec pod install
```

Configure the threaded runtime from the app delegate before any secondary runtime is created:

```swift
import NativeComposeThreadedRuntime

ThreadedRuntime.configure(
  withReactNativeDelegate: delegate,
  launchOptions: launchOptions
)
```

If your app wants a runtime ready at startup, prewarm it from Swift:

```swift
ThreadedRuntime.prewarmRuntime("conversation-inbox-runtime")
```

## Android

Add extra packages that threaded runtimes need but that may not be part of the generated host package list:

```kotlin
import com.nativecompose.threadedruntime.ThreadedRuntime
import com.nativecompose.threadedzustand.ThreadedZustandPackage
import com.margelo.nitro.NitroModulesPackage

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()

    ThreadedRuntime.setExtraReactPackagesProvider {
      listOf(
        NitroModulesPackage(),
        ThreadedZustandPackage(),
      )
    }

    loadReactNative(this)
  }
}
```

Prewarm a named runtime from Kotlin when useful:

```kotlin
ThreadedRuntime.prewarmRuntime(
  applicationContext,
  "conversation-inbox-runtime",
)
```

If a long-lived background business runtime should use the same native modules
as the main app runtime, provide the app package list and prewarm it as a
business runtime:

```kotlin
import com.facebook.react.PackageList
import com.nativecompose.threadedruntime.ThreadedRuntime

ThreadedRuntime.setMainReactPackagesProvider {
  PackageList(this).packages
}

ThreadedRuntime.prewarmBusinessRuntime(applicationContext, "business-runtime")
```

## Metro

Wrap your Metro config so the package can generate the threaded entry file:

```js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withThreadedRuntime } = require('@react-native-runtimes/core/metro');

const config = {};

module.exports = withThreadedRuntime(
  mergeConfig(getDefaultConfig(__dirname), config),
  {
    roots: ['App.tsx', 'src'],
    generatedDir: '.threaded-runtime',
    generatedEntry: 'entry.js',
  },
);
```

Add the generated folder to `.gitignore`:

```gitignore
.threaded-runtime/
```

Load the generated entry only inside threaded runtimes:

```js
const {
  isMainRuntime,
} = require('@react-native-runtimes/core');

if (!isMainRuntime()) {
  require('./.threaded-runtime/entry');
}
```

The generated entry registers lazy component loaders and the `ThreadedRuntimeHost` root used by native.

For runtime-specific startup code, add root-level files named
`index.<runtime>.ts`, for example `index.business-runtime.ts`. The generated
entry emits static conditional requires for those files and matches `<runtime>`
against `getCurrentRuntime().kind` and `.name`.

## Runtime Globals

Use the public runtime helpers in app code:

```ts
import { getCurrentRuntime, isMainRuntime } from '@react-native-runtimes/core';
```

`global.__THREADED_RUNTIME_ENV__` is the only supported runtime identity global.
It is installed before the secondary runtime bundle executes and currently
contains `kind` and `runtimeName`.

`global.__rnrRegisterRuntimeFunction` and `global.__rnrCallRuntimeFunction` are
internal implementation details for runtime functions and should not be used by
app code.
