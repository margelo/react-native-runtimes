# @react-native-runtimes/core

Small React Native API for mounting selected React components in a named
secondary React Native/Hermes runtime.

The package owns the JS registry and host API:

- `threadedComponent(name, Component)`
- `OnRuntime`
- `Threaded`
- `ThreadedScreen`
- `withThreadedRuntime(config, options)` from
  `@react-native-runtimes/core/metro`
- `registerLazyThreadedComponent(name, loadComponent)`
- `registerThreadedComponent(name, Component)`
- `registerThreadedHeadlessTask(name, task)`
- `runtimeFunction(fn)`
- `call(runtimeFunction).on(runtimeName)(...args)`
- `usingRuntime(runtimeName).run(() => runtimeFunctionCall(...))`
- `ThreadedReactSurface`
- `ThreadedRuntimeHost`
- `ThreadedRuntime.prewarm/preload/runHeadlessTask/run/destroy/destroyAll/getRuntimeNames`

## Setup

### 1. Configure Metro

Add the Metro wrapper from this package to your app's `metro.config.js`:

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

`roots` are the files/directories scanned for `threadedComponent(...)` exports.
The wrapper writes `.threaded-runtime/entry.js` and adds the generated directory
to Metro's `watchFolders`. It also discovers root-level runtime entry files
named `index.<runtime>.ts` and emits static conditional requires for them.

Add the generated directory to `.gitignore`:

```gitignore
.threaded-runtime/
```

### 2. Load The Generated Entry

Load the generated entry only in the secondary runtime path:

```js
if (global.__THREADED_RUNTIME_ENV__) {
  require('./.threaded-runtime/entry');
}
```

The generated entry registers lazy component loaders and the
`ThreadedRuntimeHost` root:

```js
import { AppRegistry } from 'react-native';
import {
  ThreadedRuntimeHost,
  registerLazyThreadedComponent,
} from '@react-native-runtimes/core';

registerLazyThreadedComponent(
  'MessageList',
  () => require('../src/MessageList').MessageList,
);

AppRegistry.registerComponent('ThreadedRuntimeHost', () => ThreadedRuntimeHost);
```

You can split runtime-only startup code into root files:

```txt
index.business-runtime.ts
index.two-runtimes-business-runtime.ts
```

Only files matching `index.<runtime>.ts` in the project root are discovered.
The generated entry requires a file when `<runtime>` matches either
`global.__THREADED_RUNTIME_ENV__.kind` or
`global.__THREADED_RUNTIME_ENV__.runtimeName`.

The component module is required only when `ThreadedRuntimeHost` receives that
component name.

### 3. Mark Components And Render Them

Most consumers should mount a top-level component inside `OnRuntime`. Metro
treats the direct child component as a threaded boundary.

```tsx
import {
  OnRuntime,
  ThreadedScreen,
  threadedComponent,
} from '@react-native-runtimes/core';

type MessageListProps = {
  conversationId: string;
  initialIndex?: number;
};

function MessageList(props: MessageListProps) {
  return <ActualMessageList {...props} />;
}

<OnRuntime name="messages-runtime">
  <MessageList conversationId={conversationId} initialIndex={120} />
</OnRuntime>;
```

Metro sees `MessageList` as the direct child of `OnRuntime` and rewrites it to
an exported `threadedComponent(...)` registration with a stable file-based id.
`OnRuntime` serializes the child props and mounts a native
`ThreadedRuntimeSurface` with the generated component name. Props must be
JSON-serializable; large or mutable data should be passed by id/key and read
through a shared native store. Keep inferred components in module/global scope
so Metro can generate the registration and the other runtime can require them by
name.

For navigation or chat apps where the whole route should live on another JS
runtime, use `ThreadedScreen`:

```tsx
export const ConversationScreen = threadedComponent<ConversationScreenProps>(
  'ConversationScreen',
  function ConversationScreen(props) {
    return <ConversationRoute {...props} />;
  },
);

<ThreadedScreen
  component={ConversationScreen}
  props={{ conversationId }}
  runtimeName={`conversation-${conversationId}`}
  testID="conversation-threaded-screen"
/>;
```

`ThreadedScreen` renders the threaded surface as a full-size screen (`flex: 1`),
preloads the named runtime by default, and keeps the runtime alive when the
screen unmounts. Set `destroyOnUnmount` when the route should release its
secondary runtime immediately.

Use `threadedComponent` and `Threaded` directly when you want a custom component
name or need to bypass the directive transform.

You can also prewarm the runtime before rendering the screen:

```tsx
import { ThreadedRuntime } from '@react-native-runtimes/core';

await ThreadedRuntime.prewarm(`conversation-${conversationId}`);
```

`prewarm` creates and starts the named secondary runtime without mounting a
surface. `preload` is kept as a compatibility alias.

## Headless Work On A Threaded Runtime

Prewarming starts the secondary runtime and loads the bundle, but it does not
give you a clear app-level API for background work. Use headless tasks when you
want to run JS on a named threaded runtime without mounting a view.

Register the task in a module that is loaded by the threaded bundle. If you use
the Metro wrapper, exporting this registration from one of the scanned roots is
enough because `.threaded-runtime/entry` is loaded in the secondary runtime.

```tsx
import { registerThreadedHeadlessTask } from '@react-native-runtimes/core';
import { messagesStore } from './messagesStore';

registerThreadedHeadlessTask<{
  conversationId: string;
  limit: number;
}>('hydrateConversation', async ({ payload, runtimeName }) => {
  const messages = await loadMessages(payload.conversationId, payload.limit);
  await messagesStore.setSubtreeState(payload.conversationId, messages, true);
  console.info(`Hydrated ${payload.conversationId} on ${runtimeName}`);
});
```

Dispatch it from the main runtime:

```tsx
import { ThreadedRuntime } from '@react-native-runtimes/core';

await ThreadedRuntime.runHeadlessTask('hydrateConversation', {
  runtimeName: 'conversation-worker-runtime',
  payload: {
    conversationId,
    limit: 50,
  },
});
```

`runHeadlessTask` starts or reuses the named runtime and asks that runtime to
invoke the registered task. If the runtime is still starting, native queues the
task and flushes it when that runtime is ready. The returned promise resolves
when native accepts the dispatch; it does not wait for the async task body to
finish. Pass durable output through shared native state, storage, or native
modules.

Headless tasks are useful for:

- warming shared stores before a threaded screen opens
- fetching or decoding data away from the main JS runtime
- running reducer/store work in a long-lived runtime
- keeping a runtime hot without attaching a `Threaded` surface

If you only need to make startup faster, `ThreadedRuntime.prewarm(runtimeName)`
is still enough. Use `runHeadlessTask` when you need actual JS work to execute.

## Await Runtime Functions

Use `runtimeFunction` when the caller needs to await the result of a named
function running on a chosen runtime. Arguments and return values are serialized
as JSON. This is the request/response API for work that should execute on
another runtime and return a value to the caller.

### Function Used Only On A Single Thread

When a function should always run on the same runtime, define it in module/global
scope and put that runtime name as the first string directive in the function
body:

```tsx
async function sum(a: number, b: number) {
  'background';
  return a + b;
}

const result = await sum(5, 1);
```

Metro turns that into a registered runtime function and replaces the original
function with a scheduled alias:

```tsx
export const sum_ = runtimeFunction.withId(
  'src/math.sum_',
  async function sum(a: number, b: number) {
    'background';
    return a + b;
  },
);

const sum = call(sum_).on('background');
const result = await sum(5, 1);
```

The generated `sum_` export is intentionally private-looking, but it must exist
so other runtimes can load the function through `require(file).sum_`.

Use this shortcut for fixed-runtime helpers. Use `call(fn).on(runtimeName)` when
the caller should choose the runtime.

### Function Used On Different Runtimes

When the caller should choose the runtime, export a runtime function and schedule
it with `call(fn).on(runtimeName)(...args)`:

```tsx
import { call, runtimeFunction } from '@react-native-runtimes/core';

function fibonacciNumber(n: number) {
  if (n < 2) {
    return n;
  }

  return fibonacciNumber(n - 1) + fibonacciNumber(n - 2);
}

export const fibonacci = runtimeFunction((n: number) => {
  const input = Math.max(0, Math.min(45, Math.floor(n)));

  return {
    input,
    result: fibonacciNumber(input),
    computedAt: new Date().toISOString(),
  };
});

const result = await call(fibonacci).on('fibonacci-worker-runtime')(38);
```

The `call(fn).on(runtimeName)(...args)` form is compile-time syntax. The Metro
transformer rewrites it before the app runs:

```tsx
await fibonacci.runOn('fibonacci-worker-runtime', 38);
```

### Function Directive Details

Use a function directive when the function always belongs on the same runtime.
The function must be declared in module/global scope, and the directive must be
the first statement in the function body:

```tsx
async function refreshCache(key: string) {
  'background';
  await cacheStore.hydrate();
  return cacheStore.get(key);
}

const value = await refreshCache('settings');
```

That source keeps call sites ordinary while still scheduling the work on the
named runtime. Metro generates a hidden exported runtime function and replaces
the original function with a scheduled alias:

```tsx
export const refreshCache_ = runtimeFunction.withId(
  'src/cache.refreshCache_',
  async function refreshCache(key: string) {
    'background';
    await cacheStore.hydrate();
    return cacheStore.get(key);
  },
);

const refreshCache = call(refreshCache_).on('background');
```

Prefer this shortcut for fixed-runtime helpers. Prefer
`call(fn).on(runtimeName)(...args)` when the caller should choose the runtime.

`runtimeFunction` marks a function as callable from another runtime. It attaches
the generated function id, exposes the typed `.runOn(runtimeName, ...args)` API,
and gives Metro a clear export boundary to register. Metro can generate the
stable id, but it still needs to know which exported functions are safe to
schedule. The wrapper is the explicit contract that says this function accepts
JSON inputs, returns JSON output, and can be loaded by another runtime.

The runtime function must be exported from a project file so the target runtime
can find the same code in its own bundle. Metro annotates exported
`runtimeFunction(...)` declarations with a stable id based on the file path and
export name, then generates a registration that looks like this:

```tsx
registerRuntimeFunction(
  'src/examples/fibonacciRuntimeFunction.fibonacci',
  () => require('./src/examples/fibonacciRuntimeFunction').fibonacci,
);
```

When `runOn` is called, native sends the target runtime name, function id, and
JSON arguments to C++/JSI. The target runtime looks up the registered loader,
caches the loaded function, parses the JSON arguments, calls the function, then
serializes the returned value back to the caller.

The `call(...).on(...)` helper accepts one exported runtime function and forwards
the arguments to that function on the target runtime:

```tsx
await call(fibonacci).on('fibonacci-worker-runtime')(38);
```

For a fixed-runtime helper, use a top-level function directive:

```tsx
async function sum(a: number, b: number) {
  'background';
  return a + b;
}

await sum(5, 1);
```

The callback form is still supported when you prefer the runtime-first shape:

```tsx
import { usingRuntime } from '@react-native-runtimes/core';

await usingRuntime('fibonacci-worker-runtime').run(() => fibonacci(38));
```

For explicit stable ids, use `runtimeFunction.named` or
`runtimeFunction.withId`:

```tsx
export const fibonacci = runtimeFunction.named(
  'examples.fibonacci',
  (n: number) => {
    return fibonacciNumber(n);
  },
);
```

Current constraints:

- arguments and return values must be JSON-serializable
- the scheduled function must be exported and registered with `runtimeFunction`,
  or use the top-level function directive shortcut
- directive shortcut functions must be declared in module/global scope
- inline lambdas and non-exported functions are not scheduled across runtimes
- closures are not captured; pass all inputs as arguments
- directive shortcut functions are rewritten to `const` aliases, so define them
  before calling them
- synchronous functions avoid the extra Promise hop on the target runtime

## Native Headless Dispatch

Native code can dispatch the same registered headless tasks. The caller chooses
which named runtime handles the task. If that runtime has been prewarmed but is
not ready yet, the dispatch is queued and flushed after startup. If it has not
been created yet, native creates and starts it.

Kotlin:

```kotlin
import com.nativecompose.threadedruntime.ThreadedRuntime

ThreadedRuntime.dispatchHeadlessTask(
  context = applicationContext,
  runtimeName = "conversation-worker-runtime",
  taskName = "hydrateConversation",
  payloadJson = """{"conversationId":"inbox","limit":50}""",
)
```

Swift:

```swift
import NativeComposeThreadedRuntime

ThreadedRuntime.dispatchHeadlessTask(
  withRuntimeName: "conversation-worker-runtime",
  taskName: "hydrateConversation",
  payloadJson: #"{"conversationId":"inbox","limit":50}"#
)
```

C++ on Android:

```cpp
#include <nativecompose/threadedruntime/ThreadedRuntimeDispatcher.h>

nativecompose::threadedruntime::dispatchHeadlessTask(
    env,
    applicationContext,
    "conversation-worker-runtime",
    "hydrateConversation",
    R"({"conversationId":"inbox","limit":50})");
```

C++/Objective-C++ on Apple platforms:

```cpp
#include <nativecompose/threadedruntime/ThreadedRuntimeDispatcher.h>

nativecompose::threadedruntime::dispatchHeadlessTask(
    "conversation-worker-runtime",
    "hydrateConversation",
    R"({"conversationId":"inbox","limit":50})");
```

Generator rules:

- components must be named exports
- threaded names must be unique
- generated output must be deterministic
- duplicate names should fail the build
- generated root should be usable both from the main app bundle and from a
  dedicated threaded runtime bundle

## Metro Generated Registry

The Metro helper is exported from the package as:

```js
const { withThreadedRuntime } = require('@react-native-runtimes/core/metro');
```

In same-bundle mode the generated lazy registry avoids eagerly initializing
every threaded component during secondary runtime startup. In a future
separate-bundle mode, the same generated entry can become the Metro entrypoint
for a smaller `threaded-runtime.android.bundle`.

## Manual Registration Escape Hatch

Register threaded components at module load time. The threaded runtime loads the
same JS bundle, but uses `ThreadedRuntimeHost` as the app root, so registration
code must not mount the main app by itself. This is useful when you are not using
the Metro generated registry.

```tsx
import { registerThreadedComponent } from '@react-native-runtimes/core';

function ExpensivePanel({ runtimeName }: { runtimeName?: string }) {
  return <Panel title={runtimeName ?? 'threaded'} />;
}

registerThreadedComponent('ExpensivePanel', ExpensivePanel);
```

## Mount A Threaded Surface

```tsx
import { ThreadedReactSurface } from '@react-native-runtimes/core';

<ThreadedReactSurface
  componentName="ExpensivePanel"
  initialProps={{ mode: 'compare' }}
  runtimeName="analytics-runtime"
  style={{ flex: 1 }}
  surfaceKey="analytics-panel"
/>;
```

`initialProps` are JSON serialized and passed to the threaded root. Changing
`componentName`, `initialProps`, `runtimeName`, or `surfaceKey` restarts the
native surface.

## Manual Host Registration

If you are not using `.threaded-runtime/entry`, the secondary runtime must
register `ThreadedRuntimeHost` under the same app name that native uses when it
creates a surface:

```js
const { AppRegistry } = require('react-native');

if (global.__THREADED_RUNTIME_ENV__) {
  require('./App'); // component registrations
  AppRegistry.registerComponent(
    'ThreadedRuntimeHost',
    () => require('@react-native-runtimes/core').ThreadedRuntimeHost,
  );
}
```

## Native Implementation

This package includes Android and iOS implementations under `android/` and
`ios/`. It exports:

- native module `ThreadedRuntime`
- native view manager `ThreadedRuntimeSurface`

`ThreadedRuntimeSurface` creates a named secondary runtime and mounts
`ThreadedRuntimeHost` in that runtime. On Android this is backed by `ReactHost`;
on iOS it is backed by `RCTHost` and a Fabric surface.

The native module exposes:

- `prewarmRuntime(runtimeName)`
- `prewarmRuntimeWithOptions(runtimeName, kind, useMainNativeModules)`
- `prewarmBusinessRuntime(runtimeName)`
- `preloadRuntime(runtimeName)`
- `dispatchHeadlessTask(runtimeName, taskName, payloadJson)`
- `runHeadlessTask(runtimeName, taskName, payloadJson)`
- `destroyRuntime(runtimeName)`
- `destroyAllRuntimes()`
- `getRuntimeNames()`

The native view manager accepts:

- `appName`
- `blockStatus`
- `componentName`
- `initialPropsJson`
- `mode`
- `runtimeName`
- `surfaceKey`

If the threaded runtime needs extra native modules or native views, configure
them once from the host app:

```kotlin
import com.nativecompose.threadedruntime.ThreadedRuntime

ThreadedRuntime.setExtraReactPackagesProvider {
  listOf(AppSpecificPackage())
}
```

Those packages are installed only in the secondary runtime. The example app uses
this to expose the shared zustand module and background list host to threaded RN.

For an app-lifetime business runtime that should see the same native module set
as the main runtime, pass the app package list once and prewarm the named
business runtime:

```kotlin
import com.facebook.react.PackageList
import com.nativecompose.threadedruntime.ThreadedRuntime

ThreadedRuntime.setMainReactPackagesProvider {
  PackageList(this).packages
}

ThreadedRuntime.prewarmBusinessRuntime(applicationContext, "business-runtime")
```

That runtime receives `global.__THREADED_RUNTIME_ENV__` before the bundle runs:

```tsx
if (global.__THREADED_RUNTIME_ENV__?.kind === 'business-runtime') {
  require('./src/businessRuntimeEntry');
} else {
  require('./src/mainRuntimeEntry');
}
```

iOS threaded runtimes already use the configured React Native delegate for
native-module lookup, so `ThreadedRuntime.prewarmBusinessRuntime("business-runtime")`
uses the app's module resolution path.

Host apps can prewarm a runtime from Kotlin before a threaded screen is needed:

```kotlin
import com.nativecompose.threadedruntime.ThreadedRuntime

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()

    ThreadedRuntime.setExtraReactPackagesProvider {
      listOf(AppSpecificPackage())
    }

    loadReactNative(this)
    ThreadedRuntime.prewarmRuntime(
      applicationContext,
      "conversation-inbox-runtime",
    )
  }
}
```

This creates and starts the named `ReactHost` without attaching a surface. When
`ThreadedScreen` later mounts with the same `runtimeName`, native reuses the
prewarmed runtime and resumes it with the current Activity.

Host apps can prewarm a runtime from Swift after configuring the package with
the app's React Native delegate:

```swift
import NativeComposeThreadedRuntime

let delegate = ReactNativeDelegate()
let factory = RCTReactNativeFactory(delegate: delegate)
delegate.dependencyProvider = RCTAppDependencyProvider()

ThreadedRuntime.configure(
  withReactNativeDelegate: delegate,
  launchOptions: launchOptions
)

factory.startReactNative(
  withModuleName: "NativeComposeChat",
  in: window,
  launchOptions: launchOptions
)

ThreadedRuntime.prewarmRuntime("conversation-inbox-runtime")
```

This creates and starts the named `RCTHost` without attaching a surface. When
`ThreadedScreen` later mounts with the same `runtimeName`, native reuses the
prewarmed host.
