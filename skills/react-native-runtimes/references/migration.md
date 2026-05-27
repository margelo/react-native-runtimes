# Migration

This reference covers migrating to `@react-native-runtimes/core` from libraries that solve adjacent problems: `react-native-worklets-core`, `react-native-multithreading`, raw JSI worklets.

Load this reference FIRST when the user shows worklets-core code, multithreading code, or asks "how do I move from X to this".

Before writing any migrated code, make sure setup is in place: Metro wrapper, `index.js` gate, native config. See [quickstart.md](quickstart.md). The migrated code below assumes those are done.

## Migrating from `react-native-worklets-core` / `react-native-multithreading` / JSI worklets

These libraries run a function on a worklet thread that **shares JSI memory** with the UI runtime. Captured variables work, `runOnJS` bridges back, `useSharedValue` enables synchronous mutation.

`@react-native-runtimes/core` is a different shape: each named runtime is a **full secondary RN runtime** with its own Hermes instance, its own JS heap, and its own copies of every module. The translation is conceptual, not mechanical.

### Side-by-side mapping

| Worklets-core pattern | react-native-runtimes equivalent |
| --- | --- |
| `Worklets.createRunOnJS(fn)` / `runOnJS(fn)` | `runtimeFunction(fn)` + `call(fn).on('main')(...)` from the background runtime, *or* a `'main'` function directive |
| `useWorklet(fn)` / `Worklets.createRunInContextFn(fn)` | Either: a `'background'` function directive (function bound to one runtime), `call(fn).on('background')(...)` (caller picks runtime), `runHeadlessTask` (fire-and-forget, no return value), or `OnRuntime` (whole component on another runtime). Closures don't carry — convert captured vars to function arguments or shared store values. |
| Shared values (`useSharedValue`, `runOnUI` mutations) | `createSharedStore({...}).path('key')` — explicit JSON, native-backed. No synchronous SharedValue-style mutation from the UI thread; use `path.use()` in React, `path.get()` outside it. |
| `react-native-multithreading` `spawnThread(() => ...)` | A `runtimeFunction` on a named worker runtime, or a headless task if the caller doesn't need a return value. **Don't spin up a runtime per task** — prewarm one named worker and reuse it. |
| Worklet-only native bindings (e.g. mmkv worklet bindings) | Use the regular module — threaded runtimes are full RN runtimes. On Android, add the module's package to `setExtraReactPackagesProvider` (autolinking only wires the main runtime). |
| Frame callbacks / `runOnUI` for animation | **Stay on worklets.** This library is for screen-scoped or app-lifetime work, not per-frame animation. Don't migrate animation loops. |

### Concrete example — `react-native-worklets-core` to `@react-native-runtimes/core`

**Before (worklets-core):** the worklet reads a module-scope `config`, parses JSON on the worklet thread, returns via runOnJS.

```ts
// src/parsing/parser.ts (worklets-core)
import { Worklets } from 'react-native-worklets-core';

let config = { schemaVersion: 2, strict: true };

export function setParserConfig(next: Partial<typeof config>) {
  config = { ...config, ...next };
}

const parseInBackground = Worklets.createRunInContextFn((raw: string) => {
  'worklet';
  const parsed = JSON.parse(raw);
  if (config.strict && parsed.schemaVersion !== config.schemaVersion) {
    throw new Error('schema mismatch');
  }
  return parsed;
});

export async function parseOnUI(raw: string) {
  return await parseInBackground(raw);
}
```

**After — option 1: pass config as an argument (recommended one-to-one).** Cleanest translation; the runtime function receives everything it needs.

```ts
// src/parsing/parser.ts (react-native-runtimes)
import { runtimeFunction } from '@react-native-runtimes/core';

export type ParserConfig = { schemaVersion: number; strict: boolean };

export const parseJson = runtimeFunction(
  (raw: string, config: ParserConfig) => {
    const parsed = JSON.parse(raw);
    if (config.strict && parsed.schemaVersion !== config.schemaVersion) {
      throw new Error('schema mismatch');
    }
    return parsed;
  },
);
```

```tsx
// Caller:
import { call } from '@react-native-runtimes/core';
import { parseJson } from '../parsing/parser';

const config = { schemaVersion: 2, strict: true };
const result = await call(parseJson).on('parser')(raw, config);
```

**After — option 2: function directive (call sites stay ordinary).** Use when the parser always belongs on one runtime.

```ts
import { runtimeFunction } from '@react-native-runtimes/core';

export async function parseJson(raw: string, config: ParserConfig) {
  'parser';
  const parsed = JSON.parse(raw);
  if (config.strict && parsed.schemaVersion !== config.schemaVersion) {
    throw new Error('schema mismatch');
  }
  return parsed;
}

// Caller — vanilla call:
const result = await parseJson(raw, config);
```

**After — option 3: config in shared state.** Right when many runtimes / many call sites need to agree on the same `config`.

```ts
import { createSharedStore } from '@react-native-runtimes/state';

export const settingsStore = createSharedStore({
  name: 'settings',
  initialState: { parser: { schemaVersion: 2, strict: true } },
});
export const parserConfig = settingsStore.path<ParserConfig>('parser');
```

```ts
import { runtimeFunction } from '@react-native-runtimes/core';
import { parserConfig } from '../state/settingsStore';

export const parseJson = runtimeFunction((raw: string) => {
  const config = parserConfig.get();           // SYNC — no await
  const parsed = JSON.parse(raw);
  if (config.strict && parsed.schemaVersion !== config.schemaVersion) {
    throw new Error('schema mismatch');
  }
  return parsed;
});
```

```tsx
// Mutate the config from anywhere; both runtimes see it on the next read.
await parserConfig.update(prev => ({ ...prev, strict: false }));
const result = await call(parseJson).on('parser')(raw);
```

### What doesn't translate cleanly

When migrating, expect to handle these explicitly:

1. **Captured closures.** Module-scope `let`s read by the function body must become arguments or shared state. The target runtime has its own module evaluation.
2. **Everything is JSON at the boundary.** `Date` becomes `{}` unless `.toISOString()` first. `Map` / `Set` / class instances / `Error` / `BigInt` / circular refs all fail.
3. **`runOnJS` has no exact analogue.** A `runtimeFunction`'s Promise resolution *is* the cross-runtime bridge for return values. For mid-execution updates, push to a shared store path from inside the function — the caller's `path.use()` subscription will re-render. For "schedule work back on main," use a `'main'` directive function.
4. **No `SharedValue` synchronous reads.** Reanimated SharedValues let the UI thread read/write a value with no native hop. Shared state here is JSON; reads are sync (`path.get()`) but writes are async commits. Not appropriate for per-frame animation — keep that on worklets.
5. **Per-frame work belongs on worklets.** This library is for screen-scoped (chat thread, importer screen) or app-lifetime (sync engine, business runtime) work. Don't migrate the animation loop.
6. **Errors don't carry stacks** across the runtime boundary. A throw on the worker rejects on the caller with the message, but no caller-side stack frame. Log on both sides.
7. **Cost model is different.** A worklet context is cheap; a named RN runtime is hundreds of ms to cold-start (bundle parse + module evaluation). Prewarm one worker runtime and reuse it, don't churn.
8. **Android native modules need explicit declaration.** Autolinking only installs modules into the main runtime — add anything the threaded runtime calls to `ThreadedRuntime.setExtraReactPackagesProvider` (or `setMainReactPackagesProvider` for the full main set). On iOS the configured RN delegate is reused, so module lookup is the same path — but `ThreadedRuntime.configure(...)` must run before any surface.
9. **Hermes only.** JSC is not a supported engine for threaded runtimes.

### Checklist when migrating a worklet

1. Identify what the worklet reads from module scope. Convert each capture to a function argument or move it into `createSharedStore`.
2. Pick the shape: `'background'` directive (function bound to a runtime), `call(fn).on(name)(...)` (caller picks runtime), or `runHeadlessTask` (fire-and-forget).
3. Replace `runOnJS` calls: return the value, or write to a shared path the main runtime subscribes to.
4. Wire up the named worker runtime: install Metro wrapper, gate `index.js`, configure iOS, install Android packages, optionally prewarm at startup.
5. Verify `runOnJS`-style mid-execution updates either become shared-store writes or `'main'` directive calls.
6. Don't touch animation worklets unless they're doing screen-scoped work — keep the worklet library for per-frame loops.

## Related

- Full surface of the API you're migrating *to* — `runtimeFunction`, `call(fn).on(...)`, directives → [runtime-functions.md](runtime-functions.md)
- Mounting a component or screen on a runtime (the replacement for "the whole screen is a worklet context") → [rendering-components.md](rendering-components.md)
- Shared state — the replacement for captured module-scope variables → [shared-state.md](shared-state.md)
- Lifecycle (prewarm one worker runtime, don't churn per task) → [headless-and-lifecycle.md](headless-and-lifecycle.md)
- Symptoms during migration — stale closures, lost props, native modules missing on the threaded side → [gotchas.md](gotchas.md)
