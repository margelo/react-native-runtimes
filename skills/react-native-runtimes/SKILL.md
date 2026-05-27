---
name: react-native-runtimes
description: Install, configure, and write code with the @react-native-runtimes/core and @react-native-runtimes/state packages — named secondary React Native (Hermes) runtimes for rendering components, scheduling awaitable functions, and running headless background work, plus the C++-backed shared Zustand store. Use whenever the user mentions threaded runtimes, secondary runtimes, OnRuntime, ThreadedScreen, threadedComponent, runtimeFunction, the `'background'`/`'main'` function directives, ThreadedRuntime.prewarm/runHeadlessTask, the `.threaded-runtime/entry.js` Metro generated file, createSharedStore / store.path, or wants to move long lists, chat screens, or sync engines off the main JS thread. Also use when migrating away from react-native-worklets-core, react-native-multithreading, JSI worklets, or from the older manual `registerThreadedComponent` / top-level path APIs in this package.
metadata:
  type: skill
---

# react-native-runtimes

Two packages: `@react-native-runtimes/core` owns named secondary RN runtimes (extra `ReactHost` on Android, `RCTHost` on iOS, each with its own Hermes runtime, JS heap, and microtask queue). `@react-native-runtimes/state` is a Zustand-shaped store whose JSON is held in a process-wide C++ singleton so every runtime can read and commit the same data.

Use this skill when the user is installing the packages, writing code with them, migrating from older patterns or competing libraries, or hitting one of the runtime/serialization/Metro gotchas.

## When to reach for it

- A specific screen, list, or route should keep rendering while the main JS thread is busy (chat threads, FlashList/LegendList, parsers).
- An expensive function should return a value to the caller but should not run on the main thread (compute, decoding, crypto).
- App-lifetime background work should stay hot: sync engines, queues, indexers.
- Two runtimes need to read and write the same data without prop drilling huge payloads through the bridge.

If the only need is "run JS off the UI thread occasionally," **react-native-worklets-core** is a smaller, simpler fit. This package is for app architectures where another *named, persistent* runtime owns a slice of work for the lifetime of a screen or the whole app.

## Architecture in one paragraph

Each runtime has a string name (e.g. `conversation-42-runtime`, `background`). Native creates one `ReactHost`/`RCTHost` per name and loads the same JS bundle into it. Inside that bundle, a generated entry (`.threaded-runtime/entry.js`) registers component loaders, headless tasks, and `runtimeFunction`s by stable id, then registers `ThreadedRuntimeHost` as the React root native uses for surfaces. Calls between runtimes go through JSI/C++: native serializes args as JSON, dispatches by `(runtimeName, functionId)`, and serializes the return value back.

The whole API is built on top of:
- `OnRuntime` / `Threaded` / `ThreadedScreen` — mount a React component in a named runtime via a `ThreadedRuntimeSurface` native view.
- `runtimeFunction` + `call(fn).on(runtimeName)(...args)` — awaitable cross-runtime function call.
- The `'background'` / `'main'` / custom function directive — Metro shortcut that registers a runtime function and replaces the original with a scheduled alias.
- `registerThreadedHeadlessTask` + `ThreadedRuntime.runHeadlessTask` — fire-and-forget background JS.
- `ThreadedRuntime.prewarm/destroy/destroyAll/getRuntimeNames` — runtime lifecycle.
- `createSharedStore` from `@react-native-runtimes/state` — C++-backed Zustand store with `.path()` handles that broadcast change events to every active runtime.

## Installation

```sh
npm install @react-native-runtimes/core @react-native-runtimes/state react-native-nitro-modules
cd ios && bundle exec pod install
```

Three setup pieces — all three are required for the default Metro-generated path to work. Skipping any of them produces confusing errors at runtime, not at build time:

### 1. Metro config

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withThreadedRuntime } = require('@react-native-runtimes/core/metro');

module.exports = withThreadedRuntime(
  mergeConfig(getDefaultConfig(__dirname), {}),
  {
    roots: ['App.tsx', 'src'],          // where to scan for OnRuntime / threadedComponent / runtimeFunction
    generatedDir: '.threaded-runtime',
    generatedEntry: 'entry.js',
  },
);
```

Add the generated folder to `.gitignore`:

```
.threaded-runtime/
```

### 2. Load the generated entry in the secondary runtime

`index.js` (or `index.ts`) is loaded by **every** runtime — main and threaded. Gate the threaded-only registration code so the main runtime does not also register `ThreadedRuntimeHost` as the app root:

```js
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

if (global.__THREADED_RUNTIME_ENV__) {
  // Threaded runtime path: load generated registry only.
  require('./.threaded-runtime/entry');
} else {
  AppRegistry.registerComponent(appName, () => App);
}
```

The generated `entry.js` registers all discovered components / runtime functions and calls `AppRegistry.registerComponent('ThreadedRuntimeHost', () => ThreadedRuntimeHost)`. The native surface always mounts the component named `ThreadedRuntimeHost`.

### 3. Native configuration

Threaded runtimes need to be told which native modules to install and (optionally) prewarmed.

**iOS — `AppDelegate.swift` (or `.mm`):**

```swift
import NativeComposeThreadedRuntime

ThreadedRuntime.configure(
  withReactNativeDelegate: delegate,
  launchOptions: launchOptions
)

// Optional: warm a runtime at launch.
ThreadedRuntime.prewarmRuntime("background")
```

**Android — `MainApplication.kt`:**

```kotlin
import com.nativecompose.threadedruntime.ThreadedRuntime
import com.nativecompose.threadedzustand.ThreadedZustandPackage
import com.margelo.nitro.NitroModulesPackage

override fun onCreate() {
  super.onCreate()

  ThreadedRuntime.setExtraReactPackagesProvider {
    listOf(
      NitroModulesPackage(),
      ThreadedZustandPackage(),
      // ...any app-specific packages the threaded runtime needs
    )
  }

  loadReactNative(this)
  // Optional prewarm
  ThreadedRuntime.prewarmRuntime(applicationContext, "background")
}
```

For a long-lived business runtime that needs the same native module set as the main runtime, use `setMainReactPackagesProvider { PackageList(this).packages }` + `prewarmBusinessRuntime(...)`. On iOS the configured RN delegate is already used, so `prewarmBusinessRuntime("name")` is enough.

## The three ways to use the package

Pick one based on what the caller needs back.

### A. Render a React component on another runtime

For a single component or a small piece of UI, wrap it in `OnRuntime`:

```tsx
import { OnRuntime } from '@react-native-runtimes/core';

function MessageList({ conversationId }: { conversationId: string }) {
  return <ActualMessageList conversationId={conversationId} />;
}

<OnRuntime name="messages-runtime">
  <MessageList conversationId="release-room" />
</OnRuntime>
```

Metro rewrites the direct child of `OnRuntime` into a `threadedComponent(...)` registration with a stable file-based id and exports it so the threaded entry can `require(file).MessageList`.

For an entire route, use `ThreadedScreen` (full-flex layout, preloads the runtime, keeps it alive when the screen unmounts unless `destroyOnUnmount`):

```tsx
export const ConversationScreen = threadedComponent<ConversationScreenProps>(
  'ConversationScreen',
  function ConversationScreen(props) { return <ConversationRoute {...props} />; },
);

<ThreadedScreen
  component={ConversationScreen}
  props={{ conversationId }}
  runtimeName={`conversation-${conversationId}-runtime`}
/>
```

**Rules:**
- The child of `OnRuntime` must be a direct component reference defined at module top level. No inline lambdas, no closures over local state.
- Props are JSON-serialized; pass ids, not large arrays, and read the data inside the threaded runtime through a shared store.
- Threaded component names must be unique across the app — duplicate names fail the Metro build.

### B. Schedule an awaitable function

Use `runtimeFunction` when one runtime needs a typed return value from work running on another runtime.

```tsx
import { call, runtimeFunction } from '@react-native-runtimes/core';

export const fibonacci = runtimeFunction((n: number) => {
  return { input: n, result: fibonacciNumber(n), computedAt: new Date().toISOString() };
});

const result = await call(fibonacci).on('fibonacci-worker')(38);
```

Metro rewrites the `call(...).on(...)(...)` form to `fibonacci.runOn('fibonacci-worker', 38)` and registers `fibonacci` under a stable id derived from the file path + export name.

When the function always belongs on the same runtime, use the **function directive** shortcut — declare the function at module scope and put the runtime name as the first string statement:

```tsx
async function refreshCache(key: string) {
  'background';
  await cacheStore.hydrate();
  return cacheStore.get(key);
}

const value = await refreshCache('settings');
```

Metro rewrites that into an exported `refreshCache_ = runtimeFunction.withId(...)` plus a local scheduled alias. Call sites stay ordinary.

Use `'main'` from a background runtime to push small UI-owned state updates back to the main runtime.

### C. Run a headless task or prewarm

For fire-and-forget background work (hydrate a store, decode a payload, warm a cache):

```tsx
// In a file the threaded bundle loads (any scanned root):
registerThreadedHeadlessTask<{ conversationId: string; limit: number }>(
  'hydrateConversation',
  async ({ payload, runtimeName }) => {
    const messages = await loadMessages(payload.conversationId, payload.limit);
    await messagesStore.path(['conversations', payload.conversationId]).set(messages, true);
  },
);

// Dispatch it from anywhere:
await ThreadedRuntime.runHeadlessTask('hydrateConversation', {
  runtimeName: 'conversation-worker-runtime',
  payload: { conversationId: 'release-room', limit: 50 },
});
```

The returned promise resolves when native **accepts** the dispatch, not when the task body finishes. Durable output must go through shared state, native storage, or a native module. Native (Kotlin / Swift / C++) can also dispatch the same tasks — see `references/api.md`.

Prewarming creates and starts the runtime without mounting a surface:

```tsx
await ThreadedRuntime.prewarm('conversation-worker-runtime');
```

`ThreadedScreen` preloads its runtime by default, but the preload runs inside a React effect. For low-latency navigation, prewarm earlier (e.g. while a picker is visible).

## Shared state across runtimes

`@react-native-runtimes/state` is a Zustand-flavored API on top of a C++ singleton.

```tsx
import { createSharedStore } from '@react-native-runtimes/state';

export const chatStore = createSharedStore<ChatState>({
  name: 'chat',
  initialState: { conversations: {}, metadata: {} },
  subtrees: ['metadata'],          // eager-hydrate these on startup
  persist: { key: 'chat-v1', subtrees: ['metadata'] }, // optional
});

// Path handles - use these everywhere; the top-level state API is legacy.
const messages = chatStore.path<Message[]>(['conversations', conversationId]);

await messages.set(nextMessages);                  // async
await messages.update(prev => [...(prev ?? []), newMessage]);   // async, atomic
const snapshot = messages.get();                   // SYNCHRONOUS — do not await
const list = messages.use(value => value ?? []);   // React hook (sync render value)
```

`set`, `update`, `hydrate`, and `clear` are async — they wait for the native commit. `get`, `use`, and `getRevision` are **synchronous**: `get()` returns a JS snapshot of the C++ value immediately, `use()` reads the snapshot during render and re-renders on commit. Don't `await` them — `await sync_value` resolves the value but masks bugs where future readers add an `await` and the call site happens to compile.

Pick `subtrees` carefully. The list names *top-level* keys that should be eagerly hydrated when the store is created. Use it for small slices the app always reads on startup (theme, current user, feature flags). **Avoid putting a dynamic-id root like `'conversations'` in `subtrees`** — it eagerly hydrates every nested id under that bucket, so a store with 200 conversations pays the full deserialization cost at launch. Per-id state should be reached through `store.path(['conversations', id])` and will hydrate lazily on first subscribe.

Subscribers on related paths are invalidated together. A subscriber on `conversations` sees changes to `conversations.release-room`, and vice versa. Prefer one writer per path or always use `update(...)` if two runtimes can write — `set(...)` of a stale snapshot will clobber concurrent writes.

For deeper API surface, see **`references/api.md`**. For the most common shared-state mistakes, see **`references/gotchas.md`**.

## Migration recipes

### From manual registration / older `react-native-runtimes` patterns

| Old | New |
| --- | --- |
| `registerThreadedComponent('Name', Component)` in user code | `threadedComponent('Name', Component)` *or* wrap in `<OnRuntime name=...>{<Component />}</OnRuntime>` and let Metro generate the registration |
| Hand-written threaded entry that imports every component eagerly | Configure `withThreadedRuntime` in `metro.config.js` and load `.threaded-runtime/entry` from `index.js` |
| `store.setSubtreeState('key', value, true)` / `store.getSubtreeState('key')` | `store.path('key').set(value, true)` / `store.path('key').get()` |
| `usingRuntime('rt').run(() => fn(args))` callback form | `await call(fn).on('rt')(args)` — both still work; the new form is what Metro understands directly |
| `ThreadedRuntime.preload(name)` | `ThreadedRuntime.prewarm(name)` — `preload` is kept as an alias |
| Inline closure passed across runtimes | Export a `runtimeFunction(...)` from a module file; pass inputs as JSON args, not as captured variables |

### From `react-native-worklets-core` / `react-native-multithreading` / raw JSI worklets

These libraries run a function on a *worklet thread*, not a full RN runtime. The translation is conceptual, not mechanical:

| Worklets pattern | react-native-runtimes equivalent |
| --- | --- |
| `Worklets.createRunOnJS(fn)` / `runOnJS(fn)` | `runtimeFunction(fn)` + `call(fn).on('main')(...)` from the background runtime. Or a `'main'` function directive. |
| `useWorklet(fn)` / `runOnUI(fn)` | Either: a `'background'` function directive (if it always runs there), or `runHeadlessTask` (fire-and-forget), or move the whole component onto a named runtime with `OnRuntime`. There is no shared JS heap, so closures don't carry — convert captured vars to function arguments. |
| Shared values (`useSharedValue`, `runOnUI` mutations) | `createSharedStore({...}).path('key')` — explicit, JSON, native-backed. No reanimated-style synchronous reads on the UI thread; use `.use()` in a React tree, or `.get()` outside of one. |
| Frame callbacks / `runOnUI` for animation | **Do not migrate this.** Worklets are the right tool for per-frame animation. Use this library for screen-scoped or app-lifetime work, not for the animation loop. |
| Worklet-only native modules (e.g. mmkv worklet bindings) | The threaded runtime is a full RN runtime — use the regular module. Make sure the module's package is included in `setExtraReactPackagesProvider` on Android (it is autolinked into the main runtime, but the threaded runtime needs to be told explicitly). |
| `react-native-multithreading` `spawnThread(() => ...)` | A `runtimeFunction` on a named worker runtime, or a headless task if the caller does not need a return value. The named runtime persists between calls; don't spin one up per task. |

**Key mental shift when migrating:** worklets share data through `SharedValue` / direct memory; this library shares data through C++-backed JSON state, and shares code by giving every runtime the same bundle and a stable function id. Arguments and return values must be JSON-serializable. Closures over local variables do not survive the boundary.

### Renaming a runtime

`runtimeName` is the identity. Changing it is creating a new runtime, not renaming the existing one. Migration steps:
1. Add the new name to any prewarm / native calls.
2. Update component/screen `runtimeName` props.
3. Drain or destroy the old runtime explicitly: `await ThreadedRuntime.destroy('old-name')` — otherwise it keeps its bundle, state subscriptions, and native module instances in memory.

## Good practices

- **Prewarm before navigation.** A cold runtime + bundle load is hundreds of ms. While a list/picker is on screen, kick off `ThreadedRuntime.prewarm(...)` for the likely-next runtime. Repeat prewarm on tap — it's cheap when the runtime already exists.
- **Keep runtime names stable for the same logical owner.** One runtime per conversation (`conversation-${id}-runtime`) is fine. A different name per render is a memory leak.
- **Pass ids, read the data inside the threaded runtime.** Props go through JSON. Sending the entire message array on every render is slower than letting the threaded runtime subscribe to a shared path.
- **Put background-only startup in `index.<runtime>.ts`.** The Metro wrapper discovers root-level files matching `index.<runtime>.ts` and conditionally requires them based on `global.__THREADED_RUNTIME_ENV__`. This is where `registerThreadedHeadlessTask`, store hydration, and queue setup belong — never UI imports.
- **One writer per path** in the shared store, or always use `update(...)`. `set(...)` of a stale snapshot races.
- **Destroy what you won't reuse — but mind re-entry cost.** Each runtime keeps its bundle, modules, and subscriptions resident. `destroyOnUnmount` on `ThreadedScreen` makes sense for genuinely one-shot routes (a one-time importer, a settings-detail screen the user rarely returns to). For routes the user re-enters often (chat threads, frequently-visited tabs), leave the runtime alive — `destroyOnUnmount` means each re-entry pays the cold bundle-load cost again, hundreds of ms. For pools and cleanup at sign-out, call `ThreadedRuntime.destroy(name)` explicitly.
- **Prefer the function directive for fixed-runtime helpers.** It generates the same `runtimeFunction` boilerplate, but call sites read like normal function calls. Use the explicit wrapper + `call(fn).on(name)(...)` when the caller picks the runtime.
- **Use synchronous functions when you can.** Sync `runtimeFunction` bodies avoid an extra Promise hop on the target runtime.

## Limits and gotchas

The cluster of issues people actually hit, in rough order of frequency:

1. **Closures don't capture.** A `runtimeFunction` body cannot read module-scope mutable state from the caller; the *target* runtime has its own copy of every module. Use function arguments and shared state.
2. **Everything across the boundary is JSON.** Functions, class instances, `Date` (becomes ISO string only if you `.toISOString()` first), refs, native handles, `Map`/`Set`, circular objects all fail or silently lose info.
3. **`runHeadlessTask` resolves on dispatch, not on completion.** If you await it expecting the task body to be done, you have a race. Use a `runtimeFunction` for request/response.
4. **`OnRuntime`'s child must be a direct, top-level component reference.** `<OnRuntime>{condition ? <A /> : <B />}</OnRuntime>` won't work — Metro can't statically identify the threaded component. Move the condition outside, or use `threadedComponent` + `Threaded` explicitly.
5. **Threaded component names must be globally unique.** Duplicate names fail the Metro build. The directive form uses a stable file-based id; explicit `threadedComponent('Name', ...)` is what you control.
6. **The function directive only works at module/global scope.** A nested function with `'background';` as the first statement is just a regular function — Metro skips it. Define directive functions at the top level, before code that calls them (they're rewritten to `const` aliases, so hoisting won't save you).
7. **`index.js` is loaded by every runtime.** Without the `global.__THREADED_RUNTIME_ENV__` gate, the threaded runtime will try to register the main app component and you'll get duplicate-registration errors or a white screen.
8. **Threaded runtimes need their packages explicitly on Android.** Autolinking installs modules into the main runtime; the threaded runtime sees only what `setExtraReactPackagesProvider` returns (plus, if you opt in, `setMainReactPackagesProvider { PackageList(this).packages }`). Symptom: a native module call from the threaded runtime returns `undefined` or throws "module not found."
9. **iOS configuration must run before any surface is created.** `ThreadedRuntime.configure(withReactNativeDelegate:launchOptions:)` belongs in `AppDelegate` before the first screen mounts. Late configuration creates a runtime without your native modules.
10. **Shared state `set(snapshot)` clobbers concurrent writes.** Use `update(prev => ...)` whenever two runtimes can write the same path.
    - Related: `path.get()` / `path.use()` / `path.getRevision()` are **synchronous**. `path.set()` / `update()` / `hydrate()` / `clear()` are async. Don't `await path.get()` — it doesn't return a Promise; awaiting a plain value silently passes through, which means a future change to make it async won't break the call site loudly.
11. **Path subscribers cascade.** Writing `conversations.release-room` notifies subscribers on `conversations` (and vice versa). Helpful, but means a global `chatStore.path('conversations').use()` re-renders on every per-conversation change.
12. **No transactions across paths.** Updating two paths is two writes with two revisions. Two runtimes can observe the intermediate state. For atomic groups, write a single composite path or carry the related fields together.
13. **Renaming = new runtime.** Changing `runtimeName` creates a fresh `ReactHost`/`RCTHost`; the old one stays until you destroy it.
14. **Each runtime is a full RN runtime, not a worker.** Bundle parse + first-run cost is real. This is why prewarm matters and why you don't want a runtime per task.
15. **Hermes only.** JSC is not a supported target. Confirm `hermesEnabled=true` on Android and the iOS pod config uses Hermes.
16. **Debugging shows multiple JS contexts.** Each runtime appears separately in Hermes Inspector / DevTools. Console output is per-runtime. Stack traces won't cross runtime boundaries.

For deeper API reference and more troubleshooting, see:

- **`references/api.md`** — full surface area of both packages (every method, every option).
- **`references/gotchas.md`** — long-form explanations of the trickier failure modes and how to diagnose them.

Read those when the user is debugging a specific symptom, looking for an option you don't remember, or asking about an edge case (concurrent writes, native dispatch, runtime kinds, persistence).
