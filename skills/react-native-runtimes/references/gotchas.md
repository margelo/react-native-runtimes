# Gotchas — debugging guide

Load this when a symptom shows up. Each section starts with what the user observes, then explains why, then shows the fix.

For background on the APIs each gotcha touches:
- Cross-runtime function calls and module-state isolation → [runtime-functions.md](runtime-functions.md)
- Mounting components, `OnRuntime` rules, surface keys → [rendering-components.md](rendering-components.md)
- Shared store sync/async split, subscriber cascade, `update` vs `set` → [shared-state.md](shared-state.md)
- Prewarm, destroy, runtime lifecycle, `runHeadlessTask` semantics → [headless-and-lifecycle.md](headless-and-lifecycle.md)
- The `index.js` gate, Metro wrapper, and Android package providers that prevent most setup gotchas → [quickstart.md](quickstart.md)

## A `runtimeFunction` returns stale or wrong data

**Symptom:** the function body reads a module-scope variable, you mutate that variable from the main runtime, and the function keeps returning the old value.

**Why:** the function runs in the *target* runtime, which has its own module evaluation. There are two independent copies of every module-scope variable — one per runtime. Mutating the caller's copy doesn't reach the target's copy.

```ts
// Bug:
let userId = 'alice';
export const fetchUser = runtimeFunction(async () => {
  return fetch(`/users/${userId}`);   // reads target runtime's copy, still 'alice'
});

userId = 'bob';
await call(fetchUser).on('background')();   // returns alice's data
```

**Fix:** pass the value as an argument, or read it from a shared store.

```ts
// Option 1: argument
export const fetchUser = runtimeFunction(async (userId: string) => {
  return fetch(`/users/${userId}`);
});
await call(fetchUser).on('background')('bob');

// Option 2: shared store
const userIdPath = sessionStore.path<string>('userId');
export const fetchUser = runtimeFunction(async () => {
  return fetch(`/users/${userIdPath.get()}`);   // SYNC get
});
await userIdPath.set('bob');
```

The same bug happens with a function directive (`async function fetchUser() { 'background'; ... }`) — the directive is sugar over the same `runtimeFunction` registration, and module state still isn't shared.

## A threaded surface is blank / shows the main app

**Symptom:** `<ThreadedScreen>` renders nothing, or you see your main app component inside the threaded surface.

**Why:** `index.js` is loaded by *every* runtime — main and threaded. Without the `global.__THREADED_RUNTIME_ENV__` gate, the threaded runtime calls `AppRegistry.registerComponent(appName, () => App)` and the threaded surface mounts the wrong component.

**Fix:** gate the threaded branch.

```js
// index.js
if (global.__THREADED_RUNTIME_ENV__) {
  require('./.threaded-runtime/entry');     // registers ThreadedRuntimeHost
} else {
  AppRegistry.registerComponent(appName, () => App);
}
```

Adjacent variant: the file does exist and the gate is right, but `roots` in `withThreadedRuntime` doesn't cover the file the component lives in. Check `metro.config.js`.

## A native module call from the threaded runtime returns undefined / throws "module not found"

**Symptom:** the main runtime can call a TurboModule / native module fine; the threaded runtime sees it as `undefined`.

**Why:** autolinking installs native modules into the **main** runtime only. Threaded runtimes see only what the package provider returns.

**Fix (Android):**

```kotlin
ThreadedRuntime.setMainReactPackagesProvider {
  PackageList(this).packages         // give threaded runtimes the same module set as main
}
// or curate:
ThreadedRuntime.setExtraReactPackagesProvider {
  listOf(NitroModulesPackage(), ThreadedZustandPackage(), /* screen-specific packages */)
}
```

**Fix (iOS):** less common — iOS reuses the RN delegate, so module lookup works through the same path. Make sure `ThreadedRuntime.configure(withReactNativeDelegate:launchOptions:)` ran in `AppDelegate` before the first surface.

## Props lose fields / `instanceof` doesn't work

**Symptom:** a value is in the props object on the calling side but missing on the threaded side. Or `props.error instanceof Error` is always false. Or a `Date` field shows up as `"2026-05-27T..."` — or worse, as `{}`.

**Why:** everything across the runtime boundary is `JSON.stringify`'d.

- Functions, refs, class instances → lost
- `Error` → becomes `{}`
- `Date` → `{}` unless you `.toISOString()` first (then it's a string)
- `Map` / `Set` → `{}`
- `undefined` values → stripped from objects, become `null` in arrays
- `BigInt` → throws
- Circular refs → throws

**Fix:** pass plain JSON. For identity, pass ids. For dates, ISO strings. For things you can't serialize, look them up on the other side through a shared store, native module, or registry.

## `runHeadlessTask` resolves but my handler hasn't run

**Symptom:** `await ThreadedRuntime.runHeadlessTask(...)` resolves, then immediately afterwards a `path.get()` returns the old value.

**Why:** the Promise resolves when native **accepts the dispatch**, not when the handler body finishes. If the runtime is still starting, the dispatch is just queued.

**Fix:** use `runtimeFunction` for request/response — its Promise waits for the function body.

```ts
const messages = await call(hydrateConversation).on('worker')({ conversationId, limit: 50 });
```

If a headless dispatch is really what you want (fire-and-forget), put the durable output into shared state or native storage, and let the caller subscribe.

## `<OnRuntime>` doesn't render anything / Metro build fails on duplicate name

**Symptom:** an `OnRuntime` with what looks like a fine child isn't producing a registered component, or Metro errors with "duplicate threaded component name."

**Why (no render):** Metro can only rewrite static, statically-identifiable children. Ternaries, prop-forwarded `children`, and wrappers (`<Suspense>`, etc.) break the analysis.

```tsx
// Doesn't work:
<OnRuntime name="x">{condition ? <A /> : <B />}</OnRuntime>
<OnRuntime name="x">{children}</OnRuntime>
```

**Fix:** move the condition outside, or use `threadedComponent` + `<Threaded>` explicitly.

```tsx
condition ? <OnRuntime name="x"><A /></OnRuntime> : <OnRuntime name="x"><B /></OnRuntime>
```

**Why (duplicate name):** two different `threadedComponent(...)` calls used the same string name, or the same component is reachable through two file paths and got two file-based ids. Names must be globally unique. The fix is to make the explicit names distinct, or convert duplicate code paths to share a single canonical component file.

## The function directive doesn't seem to dispatch anywhere

**Symptom:** `async function refresh() { 'background'; ... }` runs but stays on the main runtime.

**Why:** one of:

1. The function is nested inside another function — directives only work at module/global scope.
2. The file isn't under `roots` in `metro.config.js`.
3. Metro didn't re-run since the edit — restart with `--reset-cache`.
4. The call site is *above* the function declaration. Directive functions are rewritten to `const` aliases, so they're temporal-dead-zone'd until the declaration runs.

**Fix:** move the function to top level, ensure the file is in `roots`, restart Metro, define before first call.

## I `await path.get()` and it returns the value but other things break later

**Symptom:** code compiles, runs, returns the right value — but then someone wraps the call in `Promise.all([p1, get(), p2])` or adds `.then(...)` and it acts weird.

**Why:** `path.get()` is **synchronous**. Awaiting a non-Promise unwraps the value (a no-op), but the call site looks async, so future readers chain Promise methods on a plain value.

**Fix:** don't `await` sync methods. The sync methods are `path.get()`, `path.use()`, `path.getRevision()`. The async methods are `path.set()`, `path.update()`, `path.hydrate()`, `path.clear()`.

## A subscriber re-renders on every conversation update, even ones I don't care about

**Symptom:** a component subscribed to `chatStore.path('conversations').use()` re-renders whenever any conversation updates.

**Why:** path subscribers cascade in both directions. A change to `conversations.release-room` notifies subscribers on `conversations` (ancestor) and on `conversations.release-room` (direct hit).

**Fix:** subscribe to the narrowest path you actually need, or pass a selector to `use()` and let the path tree skip re-renders when the derived value hasn't changed.

```ts
// Re-renders only when the count changes:
const count = chatStore.path('conversations').use(v => Object.keys(v ?? {}).length);
```

## Two runtimes write the same path and one of them wins inconsistently

**Symptom:** writes from runtime A or B appear to be lost — the order isn't deterministic.

**Why:** `set(snapshot)` races. A reader takes a snapshot, builds the new value, calls `set` — but another runtime committed in between. The stale-based snapshot overwrites the concurrent write.

**Fix:** use `update(prev => next)`. Native applies the function atomically against the current value.

```ts
await messages.update(prev => [...(prev ?? []), newMessage]);
```

## Renaming a runtime didn't free the old one

**Symptom:** `getRuntimeNames()` still lists the old runtime name after a release with new naming.

**Why:** `runtimeName` is identity. Changing the name creates a new runtime; the old one stays until you destroy it.

**Fix:** at startup, destroy known old names explicitly.

```ts
for (const old of ['old-runtime-name']) {
  await ThreadedRuntime.destroy(old);
}
```

## Cold start is slower than I expected

**Symptom:** the first time the user opens a chat thread, it takes several hundred ms before the threaded screen appears.

**Why:** each named runtime is a full RN runtime. Cold start includes Hermes context creation, JS bundle parse, module evaluations, and native module instantiations.

**Fix:** prewarm earlier — while a picker or list is on screen.

```ts
useEffect(() => {
  for (const id of likelyNextConversationIds) {
    void ThreadedRuntime.prewarm(`conversation-${id}-runtime`);
  }
}, [likelyNextConversationIds]);
```

Repeat on `onPressIn` — cheap if the runtime already exists. `ThreadedScreen` does its own preload via a React effect, but the effect runs after the navigation animation starts, so explicit prewarm typically saves the bundle-load hop.

## Multiple JS contexts in DevTools / no cross-runtime stack traces

**Symptom:** Hermes Inspector / Chrome DevTools show multiple JS targets; a throw on the worker doesn't include a caller-side stack frame.

**Why:** each named runtime is a separate Hermes runtime / JS context. They're isolated by design. Stack traces don't cross runtimes.

**Fix:** this is expected. To debug, attach to both targets and log on both sides of a runtime call.

## The runtime exists but my function isn't being found there

**Symptom:** `call(fn).on('worker')()` rejects with "runtime function not found" or just hangs.

**Why:** one of:

1. The exporting file isn't under `roots` — its `registerRuntimeFunction` never ended up in `.threaded-runtime/entry.js`.
2. The function isn't actually exported.
3. The Metro-generated entry is stale. Restart with `--reset-cache`.
4. The registered loader threw silently when the threaded runtime tried to require the file. Wrap a `try` in the registration during diagnosis to find out.
5. The target runtime doesn't exist — `getRuntimeNames()` should include it. Prewarm if not.
