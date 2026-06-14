---
name: react-native-runtimes
description: Install, configure, and write code with the @react-native-runtimes/core and @react-native-runtimes/state packages — named secondary React Native (Hermes) runtimes for rendering components, scheduling awaitable functions, and running headless background work, plus the C++-backed shared Zustand store. Use whenever the user mentions threaded runtimes, secondary runtimes, OnRuntime, ThreadedScreen, threadedComponent, runtimeFunction, the `'background'`/`'main'` function directives, ThreadedRuntime.prewarm/runHeadlessTask, the `.threaded-runtime/entry.js` Metro generated file, createSharedStore / store.path, or wants to move long lists, chat screens, or sync engines off the main JS thread. Also use when migrating from react-native-worklets-core, react-native-multithreading, or raw JSI worklets.
metadata:
  type: skill
---

# react-native-runtimes

Two packages:

- `@react-native-runtimes/core` — named secondary React Native runtimes (extra `ReactHost` on Android, `RCTHost` on iOS, each with its own Hermes runtime and JS heap) for rendering components, scheduling awaitable functions, and running headless background work.
- `@react-native-runtimes/state` — a Zustand-shaped store whose JSON state lives in a process-wide C++ singleton, so every runtime can read and commit the same data.

This file is a router. Read it first, then load only the reference that matches the task — every reference is self-contained.

## When to load which reference

- **Fresh install — packages, Metro config, `index.js`, iOS `AppDelegate`, Android `MainApplication`, minimal `<ThreadedScreen>`** → [references/quickstart.md](references/quickstart.md). Load this whenever the user is setting up the library for the first time.
- **Rendering a screen or component on another runtime — `OnRuntime`, `Threaded`, `ThreadedScreen`, `threadedComponent`, `ThreadedReactSurface`, prop rules** → [references/rendering-components.md](references/rendering-components.md).
- **Awaitable cross-runtime calls — `runtimeFunction`, `call(fn).on(runtimeName)(...)`, `'background'`/`'main'` function directives, `usingRuntime`** → [references/runtime-functions.md](references/runtime-functions.md). Load this when the user wants a return value from work running on another runtime.
- **Background jobs and runtime lifecycle — `registerThreadedHeadlessTask`, `ThreadedRuntime.runHeadlessTask`, `prewarm` / `destroy` / `getRuntimeNames`, native dispatch from Kotlin / Swift / C++, `index.<runtime>.ts` startup files** → [references/headless-and-lifecycle.md](references/headless-and-lifecycle.md).
- **Sharing state across runtimes — `createSharedStore`, `store.path([...])`, sync vs async API, `subtrees`, persistence, multi-writer rules** → [references/shared-state.md](references/shared-state.md).
- **Migrating from `react-native-worklets-core`, `react-native-multithreading`, or raw JSI worklets** → [references/migration.md](references/migration.md). Load this FIRST when the user shows worklets-core or multithreading code.
- **Debugging a symptom (a runtime function returns stale data, a threaded surface is blank, a native module is missing on the threaded runtime, props lose fields)** → [references/gotchas.md](references/gotchas.md).

When unsure, start with [references/quickstart.md](references/quickstart.md) — it grounds the rest of the API in a working setup.

## Non-negotiable rules

Apply these without asking. They catch the mistakes that turn into broken builds or runtime puzzles.

1. **Install the Nitro peer.** `react-native-nitro-modules` is required by both packages. On iOS run `bundle exec pod install` after install. State needs `@react-native-runtimes/state`; rendering and runtime functions only need `core`.
2. **Metro wrapper is `withThreadedRuntime`** (from `@react-native-runtimes/core/metro`) — not `withRuntimes`, not `withReactNativeRuntimes`. Pass `roots: [...]` covering every file that contains `OnRuntime`, `threadedComponent`, `runtimeFunction`, or a function directive.
3. **`index.js` MUST gate on `global.__THREADED_RUNTIME_ENV__`.** Threaded runtimes load the same bundle as the main runtime; without the gate, both will try to register the app component and you'll get duplicate-registration errors or blank threaded surfaces. The threaded branch should `require('./.threaded-runtime/entry')`; the main branch calls `AppRegistry.registerComponent(...)`.
4. **iOS: call `ThreadedRuntime.configure(withReactNativeDelegate:launchOptions:)` in `AppDelegate` *before* the first surface mounts.** Late configuration creates threaded runtimes without your native module set.
5. **Android: threaded runtimes don't inherit autolinked packages.** Use `ThreadedRuntime.setMainReactPackagesProvider { PackageList(this).packages }` to give threaded runtimes the same module set as the main runtime, or `setExtraReactPackagesProvider { listOf(...) }` to curate a smaller list. Without this, native module calls from the threaded runtime return undefined.
6. **Closures don't cross runtimes.** A `runtimeFunction` body executes inside the *target* runtime, which has its own module evaluation and its own copies of every module-scope variable. Pass everything the function needs as arguments, or read it through a shared store. Mutating a module-scope `let` on the main runtime does not affect any other runtime.
7. **Everything across the boundary is JSON.** Function args, return values, `OnRuntime` props, headless task payloads, shared store values — all `JSON.stringify`'d. No functions, refs, class instances, `Map`/`Set`, `BigInt`, `Error`, or circular refs. `Date` becomes `{}` unless you `.toISOString()` first.
8. **`runHeadlessTask` resolves on dispatch, not on completion.** If the caller needs the task's return value, use `runtimeFunction` instead — its Promise waits for the body to finish.
9. **`OnRuntime`'s child must be a direct, top-level component reference.** Ternaries, prop-forwarded children, and wrappers (`<Suspense>`, etc.) break Metro's static analysis. Move the condition outside or use `threadedComponent` + `<Threaded>` explicitly.
10. **Shared store: `.get()` / `.use()` / `.getRevision()` are SYNCHRONOUS. `.set()` / `.update()` / `.hydrate()` / `.clear()` are async.** Don't `await path.get()` — it doesn't return a Promise, and awaiting a plain value silently masks future bugs where the call site forgets to add an await.
11. **Use `update(prev => ...)` whenever two runtimes can write the same path.** `set(snapshot)` of a stale read clobbers concurrent writes.
12. **Hermes only.** Verify `hermesEnabled=true` (Android) and the iOS Podfile uses Hermes. JSC is not a supported target for threaded runtimes.

## Operating rules

- **For per-frame animation, recommend worklets, not this library.** This library is for screen-scoped or app-lifetime work. Use `react-native-worklets-core` / Reanimated worklets for the animation loop.
- **Prewarm before navigation.** A cold runtime + bundle parse is hundreds of ms. While a picker/list is on screen, kick off `ThreadedRuntime.prewarm(nextRuntimeName)`. Repeat on `onPressIn` — cheap if the runtime already exists.
- **Stable runtime names per logical owner.** `conversation-${conversationId}-runtime` is fine — same id always picks up the same runtime. A name that changes per render is a memory leak.
- **Prefer the function directive for fixed-runtime helpers.** Top-level `async function refreshCache() { 'background'; ... }` keeps call sites looking like ordinary functions while still scheduling the work on the named runtime. Use `runtimeFunction` + `call(fn).on(name)(...)` when the *caller* picks the runtime.
- **Background-only startup goes in `index.<runtime>.ts`.** The Metro wrapper discovers root-level files named like that and conditionally requires them based on `global.__THREADED_RUNTIME_ENV__`. Register headless tasks, hydrate stores, and start queues there — never UI imports.
- **`destroyOnUnmount` only for genuinely single-use routes.** For chat threads or any screen the user re-enters often, leave the runtime alive; otherwise every re-entry pays the bundle-load cost.
- **Pass ids, not data.** Props serialize on every render. For a long chat list, write messages into a shared store path and pass only the `conversationId`; the threaded screen subscribes to that path.
- **Verify peer dependency installs.** A native crash after install is almost always a missing `react-native-nitro-modules` (both platforms), or on Android a missing `ThreadedZustandPackage()` in `setExtraReactPackagesProvider`.
- **Never invent APIs.** If a method or option is not in the references, say so and tell the user to check the package. Hallucinations to specifically avoid: `withRuntimes`, `ThreadedRuntime.register(...)`, `threadedComponent(Component, { runtime: fn })`, awaiting `.get()`.

## Authoritative links

- Main repo: https://github.com/margelo/react-native-runtimes
- Core package: `packages/core/README.md` in the repo
- State package: `packages/state/README.md` in the repo
- Example app: `example/App.tsx` and `example/src/examples/*` for working code
