# Runtime Functions

Awaitable cross-runtime calls. Use this when one runtime needs a return value from work running on another named runtime. Arguments and return values are JSON-serialized.

There are three shapes for the same underlying mechanism. Pick the shape based on whether the *caller* picks the runtime or the *function* is bound to one.

## 1. Caller picks the runtime — `runtimeFunction` + `call(fn).on(...)`

```tsx
import { call, runtimeFunction } from '@react-native-runtimes/core';

function fibonacciNumber(n: number): number {
  return n < 2 ? n : fibonacciNumber(n - 1) + fibonacciNumber(n - 2);
}

export const fibonacci = runtimeFunction((n: number) => {
  return { input: n, result: fibonacciNumber(n), computedAt: new Date().toISOString() };
});

const result = await call(fibonacci).on('fibonacci-worker')(38);
```

Metro rewrites `call(fn).on(name)(...args)` to `fn.runOn(name, ...args)` at build time and registers `fibonacci` under a stable id derived from its file path + export name.

The exported function must live in a file Metro is scanning (under `roots`).

### Explicit IDs

```tsx
// Derived id (default — file path + export name):
export const fibonacci = runtimeFunction((n: number) => /* ... */);

// Explicit stable id — useful when file paths shouldn't be part of your id surface:
export const fibonacci = runtimeFunction.named('examples.fibonacci', (n: number) => /* ... */);

// Used by the directive transform; rarely written by hand:
export const fn_ = runtimeFunction.withId('src/file.fn_', /* ... */);
```

### Callback form (still supported, legacy)

```tsx
import { usingRuntime } from '@react-native-runtimes/core';

await usingRuntime('fibonacci-worker').run(() => fibonacci(38));
```

The callback must contain exactly one call to one exported runtime function. Prefer the `call(fn).on(name)(...)` form — it's what Metro understands directly.

## 2. Function is bound to a runtime — the directive shortcut

When a function should *always* run on the same runtime, write it as an ordinary top-level function and make the runtime name its first statement:

```tsx
async function refreshCache(key: string) {
  'background';
  await cacheStore.hydrate();
  return cacheStore.get(key);
}

const value = await refreshCache('settings');
```

Metro rewrites that to a hidden exported `runtimeFunction` plus a local scheduled alias:

```tsx
// What you wrote stays in source, but Metro generates this output:
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

Call sites stay ordinary. The directive name is the runtime name — `'background'` and `'main'` are conventions, but any string is valid as long as a runtime by that name exists.

Use `'main'` from a background runtime to push small UI-owned updates back to the main runtime:

```tsx
async function markRefreshVisible(reason: string) {
  'main';
  await business.update(state => ({ ...state, lastRefreshReason: reason }));
}
```

### Rules for the directive shortcut

- **Module/global scope only.** A nested function with `'background';` as its first statement is just a regular function with a no-op string literal — Metro skips it.
- **Declarations are rewritten to `const` aliases at the same source position.** Define them before code that calls them. Function hoisting won't save you.
- **The function must be exported** if any other runtime should be able to load it (the generated `name_` export is what carries the registration).

## 3. Synchronous functions

A `runtimeFunction` body can be sync or async. Synchronous bodies avoid an extra Promise hop on the target runtime — small win, useful for hot paths. The caller still receives a Promise (because the call itself goes through native).

```tsx
export const square = runtimeFunction((n: number) => n * n); // sync body
const x = await call(square).on('math')(7);
```

## Why wrap with `runtimeFunction`?

The wrapper is the explicit contract that says: "this function is exported, registered, accepts JSON inputs, returns JSON output, and can be loaded by another runtime." Without it, Metro could try to register every plain exported function, but most plain functions close over local values, mutate module state, or accept non-serializable inputs. The wrapper makes the intent unambiguous and gives Metro a stable export boundary.

## How lookup works

Runtime function bodies are not transmitted over the wire. Metro registers each exported `runtimeFunction(...)` with a stable id in the generated entry:

```tsx
// .threaded-runtime/entry.js (generated)
registerRuntimeFunction(
  'src/examples/fibonacciRuntimeFunction.fibonacci',
  () => require('./src/examples/fibonacciRuntimeFunction').fibonacci,
);
```

Every runtime loads the same bundle, so every runtime installs the same registration table. When a caller schedules a call, native sends `(targetRuntimeName, functionId, JSON-stringified args)` to C++/JSI. The target runtime looks up the registered loader, caches the loaded function, parses the args, calls the function, and serializes the return value back.

## Constraints

- **Arguments and return values must be JSON-serializable.** Functions, refs, class instances, `Map`/`Set`, `BigInt`, `Error`, circular refs all fail or silently lose info. `Date` becomes `{}` unless you `.toISOString()` first.
- **Closures don't capture across runtimes.** A `runtimeFunction` body runs inside the target runtime, which has its own copy of every module-scope variable. Mutating a `let` in the caller's module does not affect the target runtime's copy. Pass everything as arguments, or use a shared store.
- **Scheduled functions must be exported and registered** (via `runtimeFunction(...)`, or use the directive shortcut). Inline lambdas and non-exported functions are not scheduled across runtimes.
- **Directive functions are `const` aliases** after Metro's transform — define them before the first call.
- **Errors don't carry stacks** across the boundary. A throw on the worker rejects on the caller with the message, but no caller-side stack frame. Log on both sides if you need the full picture.

## When NOT to use `runtimeFunction`

- **The caller doesn't need a return value.** Use a headless task instead — see [headless-and-lifecycle.md](headless-and-lifecycle.md). `ThreadedRuntime.runHeadlessTask` returns when native accepts the dispatch (not when the body finishes), which is the right shape for fire-and-forget.
- **Per-frame animation work.** Use `react-native-worklets-core` / Reanimated worklets. This library is for screen-scoped or app-lifetime work, not the animation loop.
- **Inline anonymous work.** Convert it to an exported `runtimeFunction` (or a directive function). Anonymous closures don't have a stable id.

## Related

- Where the target runtime comes from — prewarm, destroy, dispatch from native → [headless-and-lifecycle.md](headless-and-lifecycle.md)
- Mount a whole component instead of calling a function → [rendering-components.md](rendering-components.md)
- Share mutable values across runtimes (when "pass as argument" isn't enough) → [shared-state.md](shared-state.md)
- Migrating from `react-native-worklets-core`'s `runOnJS` / `useWorklet` → [migration.md](migration.md)
- Symptoms: stale module-scope reads, "function not found", missing stack traces → [gotchas.md](gotchas.md)
