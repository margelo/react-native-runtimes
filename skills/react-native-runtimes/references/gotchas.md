# Gotchas — long-form

Read this when the user is debugging a specific symptom, or before doing anything where any of these failure modes are plausible.

## Closures don't capture across runtimes

A `runtimeFunction` body looks like a regular JS function, but it executes inside a **different runtime with its own copy of every module**. A variable referenced by closure resolves against the target runtime's module evaluation, not the caller's.

```tsx
// src/state.ts
let userId = 'alice';
export const greet = runtimeFunction(() => `hi ${userId}`);

// Main runtime:
userId = 'bob';                              // changes only the main runtime's copy
await call(greet).on('worker')();            // returns 'hi alice' on the worker
```

Fix: pass everything you need as arguments. If multiple runtimes need to agree on mutable state, put it in `@react-native-runtimes/state`.

## Everything across the boundary is JSON

`OnRuntime` props, `runtimeFunction` arguments and return values, headless task payloads, and shared store values are all `JSON.stringify`'d at the native boundary. That means:

- Functions, class instances, refs, native handles, error objects: lost. `Error` becomes `{}`.
- `Date`: becomes a string only if you call `.toISOString()`. A raw `Date` becomes `{}`.
- `Map` / `Set`: become `{}` / `{}`.
- `undefined` values: stripped from objects, become `null` in arrays.
- `BigInt`: throws.
- Circular references: throw.
- Very large objects: cost real CPU on both sides. Pass an id and re-read the data on the other side.

Diagnosing: when a remote function returns something that looks like the right shape but is missing fields, JSON serialization is the suspect.

## `runHeadlessTask` resolves on dispatch, not on completion

```tsx
await ThreadedRuntime.runHeadlessTask('hydrate', { runtimeName, payload });
// At this point: native has accepted the dispatch.
// The handler body may not have started yet, and certainly may not be done.
```

If the caller needs to know the task is finished, use `runtimeFunction` instead — its Promise resolves with the function's return value when the body completes.

Native dispatch (Kotlin/Swift/C++) returns even sooner — the dispatch can land before the runtime exists, in which case native queues it and flushes after startup.

## `OnRuntime` child must be a direct, top-level component reference

Metro can only rewrite static, statically-identifiable children. These don't work:

```tsx
<OnRuntime name="x">{condition ? <A /> : <B />}</OnRuntime>          // ternary
<OnRuntime name="x">{children}</OnRuntime>                            // prop forwarding
<OnRuntime name="x"><Suspense fallback={...}><A /></Suspense></OnRuntime>  // wrapper
```

Fix: move the condition outside (`condition ? <OnRuntime name="x"><A /></OnRuntime> : <OnRuntime name="x"><B /></OnRuntime>`), or use `threadedComponent` + `Threaded` explicitly and let JSX wrap as it pleases on the threaded side.

The threaded child component must also be defined at module top level — not inside another function — so Metro can attach the registration to the export.

## The function directive only works at module/global scope

```tsx
// Works:
async function refreshCache(key: string) {
  'background';
  // ...
}

// Does not work — directive is just a no-op string statement in a regular function:
function makeRefresher() {
  return async function refreshCache(key: string) {
    'background';
    // runs on the current runtime, not 'background'
  };
}
```

Directive functions are also rewritten to `const X = call(X_).on(...)` aliases at the same source position. Declarations have to appear before their first call site (no value hoisting):

```tsx
await refreshCache('settings');   // ReferenceError before the directive function declaration runs
async function refreshCache(key: string) { 'background'; /* ... */ }
```

## `index.js` is loaded by every runtime

Without a gate, the threaded runtime will try to register your main app component and / or evaluate code that assumes the main runtime's modules. Gate with `global.__THREADED_RUNTIME_ENV__`:

```js
if (global.__THREADED_RUNTIME_ENV__) {
  require('./.threaded-runtime/entry');
} else {
  AppRegistry.registerComponent(appName, () => App);
}
```

Symptoms when this is wrong: blank screen on threaded surfaces (because the main app component is mounted as `ThreadedRuntimeHost`); duplicate-registration warnings; native modules that work on the main runtime returning undefined on the threaded one.

## Threaded runtimes need their native packages explicitly (Android)

Autolinking installs every linked module into the main runtime. Threaded runtimes only get what `ThreadedRuntime.setExtraReactPackagesProvider { ... }` returns.

```kotlin
ThreadedRuntime.setExtraReactPackagesProvider {
  listOf(
    NitroModulesPackage(),
    ThreadedZustandPackage(),
    // any module the threaded runtime calls
  )
}
```

For business runtimes that should mirror the main runtime's module set, use `setMainReactPackagesProvider { PackageList(this).packages }` + `prewarmBusinessRuntime`.

Symptom: a native module call from the threaded runtime returns undefined, throws "module not found," or rejects with a TurboModule lookup error. The main runtime is fine.

On iOS, the configured RN delegate is reused for threaded runtimes, so module lookup goes through the same path — no separate registration needed, but `ThreadedRuntime.configure(withReactNativeDelegate:launchOptions:)` must run before any surface.

## Shared state `set(snapshot)` clobbers concurrent writes

```tsx
const messages = chatStore.path<Message[]>(['conversations', id]);
const current = messages.get();
await messages.set([...current, newMessage]);   // race: another runtime might have written between get() and set()
```

Fix: use `update`, which atomically reads the current value and applies the function on the native side.

```tsx
await messages.update(prev => [...(prev ?? []), newMessage]);
```

Rule of thumb: if only one runtime writes a given path, `set` is fine. If multiple runtimes can write it, always `update`.

## Path subscribers cascade

A change to `conversations.release-room` notifies:
- subscribers on `conversations.release-room` (direct hit)
- subscribers on `conversations` (ancestor)
- subscribers on `conversations.release-room.*` (descendants, if any)

This is usually what you want — `chatStore.path('conversations').use()` will pick up every conversation update. But it also means a global subscription on a hot ancestor path re-renders every component using it on every leaf write. Prefer narrow paths or a selector form `path.use(value => derived)`.

## No transactions across paths

Two writes are two events. A subscriber may observe one write but not the other yet.

```tsx
await metadata.set({ updatedAt: now });   // commit A
await messages.set(newMessages);          // commit B
```

A reader on both paths can render between A and B with an inconsistent view. Fix: write the related fields together as a single composite value at one path, or design the consumer to tolerate temporary mismatch.

## Renaming a runtime is creating a new one

`runtimeName` is identity. If you change `conversation-${conversationId}-runtime` to a different scheme on a new release, the old runtimes are still there. Either:

- Migrate explicitly: call `ThreadedRuntime.destroy('old-name')` for known old names at startup.
- Use `ThreadedRuntime.destroyAll()` if the new scheme replaces everything (rare; will tear down anything else in flight).

## Each runtime is a full RN runtime, not a thin worker

Cost per runtime is non-trivial:
- Hermes context + JS bundle parse: hundreds of ms on cold start.
- Memory: the bundle is resident; every module the runtime touches is evaluated.
- Native modules: the modules in `setExtraReactPackagesProvider` are instantiated per runtime.

Design implications:
- Don't spin one up per task. Pool them by logical owner (`background`, `business-runtime`, `conversation-${id}-runtime`).
- Prewarm runtimes that the user will likely navigate to, while they are still on the previous screen.
- Destroy runtimes whose owner is gone (a closed conversation, a logged-out user) — they will not be reclaimed on their own.

## Hermes only

JSC is not a supported engine for threaded runtimes. Verify `hermesEnabled=true` in `android/gradle.properties` and that the iOS Podfile uses Hermes (`:hermes_enabled => true`).

## Debugging: each runtime is a separate JS context

In Hermes Inspector / Chrome DevTools, each named runtime shows up as a separate target. Console output is per-runtime — a `console.log` from `'background'` doesn't appear in the main runtime's Metro logs unless you tail both.

Stack traces don't cross runtimes. A `runtimeFunction` call that throws on the worker rejects on the caller with the error message but no caller-side stack. Log on both sides if you need a full picture.

## When something doesn't trigger and you expect it to

If a `runtimeFunction` call or function directive doesn't seem to be dispatching anywhere:

1. Confirm the source file is under one of the `roots` in `withThreadedRuntime`.
2. Confirm the function is **exported** (the directive form generates an export with a `_` suffix; check `.threaded-runtime/entry.js` for the registration).
3. Confirm `.threaded-runtime/entry.js` was regenerated after your last edit. Metro should re-run the wrapper on save; if not, restart with `--reset-cache`.
4. Confirm `index.js` actually requires `.threaded-runtime/entry` when `__THREADED_RUNTIME_ENV__` is set.
5. Confirm the target runtime exists — `ThreadedRuntime.getRuntimeNames()` should include it; if not, prewarm it first.

If the dispatch succeeds but nothing happens on the target side, the registered loader probably failed silently — wrap the registration's require call in a `try` and log in the threaded entry to find out.
