---
id: scheduling-functions
title: Scheduling Functions on Another Runtime
---

Use runtime functions when one runtime needs to execute registered code on
another named runtime. `call` is awaitable and returns the function result.
`schedule` is fire-and-forget: it resolves when native accepts or queues the
work, and the scheduled function must return `void | Promise<void>`.

## Function Used Only On A Single Thread

When a function should always run on the same runtime, define it in module/global
scope and put that runtime name as the first string directive in the function
body:

```tsx
async function sum(a: number, b: number) {
  "background";
  return a + b;
}

const result = await sum(5, 1);
```

Metro turns that into a registered runtime function and replaces the original
function with a scheduled alias:

```tsx
export const sum_ = runtimeFunction.withId(
  "src/math.sum_",
  async function sum(a: number, b: number) {
    "background";
    return a + b;
  }
);

const sum = call(sum_).on("background");
const result = await sum(5, 1);
```

The generated `sum_` export is intentionally private-looking, but it must exist
so other runtimes can load the function through `require(file).sum_`.

Use this shortcut for fixed-runtime helpers. Use `call(fn).on(runtimeName)` when
the caller should choose the runtime.

## Function Used On Different Runtimes

When the caller should choose the runtime, export a runtime function and invoke
it with `call(fn).on(runtimeName)(...args)`:

```tsx
import { call, runtimeFunction } from "@react-native-runtimes/core";

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

const result = await call(fibonacci).on("fibonacci-worker-runtime")(38);
```

Use `schedule` for work that reports progress through shared state, storage, or
native modules instead of returning a value:

```tsx
import { runtimeFunction, schedule } from "@react-native-runtimes/core";

export const refreshCache = runtimeFunction.named(
  "cache.refresh",
  async (key: string) => {
    await cacheStore.hydrate();
    await cacheStore.refresh(key);
  }
);

await schedule(refreshCache).on("background")("settings");
```

The `call(fn).on(runtimeName)(...args)` and
`schedule(fn).on(runtimeName)(...args)` forms are syntax for Metro to transform.
They are rewritten to direct calls on the registered runtime function:

```tsx
const result = await fibonacci.runOn("fibonacci-worker-runtime", 38);
await refreshCache.scheduleOn("background", "settings");
```

## Function Directive Details

Use a function directive when the function always belongs on the same runtime.
The function must be declared in module/global scope, and the directive must be
the first statement in the function body:

```tsx
async function refreshCache(key: string) {
  "background";
  await cacheStore.hydrate();
  return cacheStore.get(key);
}

const value = await refreshCache("settings");
```

That source keeps call sites ordinary while still scheduling the work on the
named runtime. Metro generates a hidden exported runtime function and replaces
the original function with a scheduled alias:

```tsx
export const refreshCache_ = runtimeFunction.withId(
  "src/cache.refreshCache_",
  async function refreshCache(key: string) {
    "background";
    await cacheStore.hydrate();
    return cacheStore.get(key);
  }
);

const refreshCache = call(refreshCache_).on("background");
```

Prefer this shortcut for fixed-runtime helpers. Prefer
`call(fn).on(runtimeName)(...args)` when the caller should choose the runtime.

## Why Wrap With `runtimeFunction`?

`runtimeFunction` marks a function as callable from another runtime. It attaches
the generated function id, exposes the typed `.runOn(runtimeName, ...args)` and
`.scheduleOn(runtimeName, ...args)` APIs, and gives Metro a clear export
boundary to register.

Metro can generate the stable id for this:

```tsx
export const fibonacci = runtimeFunction(fn);
```

but it still needs to know which exported functions are safe to schedule. Plain
functions can close over local values, mutate module state, depend on runtime-only
objects, or accept values that cannot be serialized. The wrapper is the explicit
contract that says: this function is exported, registered, accepts JSON inputs,
returns JSON output, and can be loaded by another runtime.

The directive shortcut generates this wrapper for top-level functions that are
bound to one runtime. Use the explicit wrapper when the same function should be
callable from different runtimes.

## How Lookup Works

Runtime functions are not sent as source code. Metro gives each exported
`runtimeFunction(...)` a stable id, then generates a registration in the bundle:

```tsx
registerRuntimeFunction(
  "src/examples/fibonacciRuntimeFunction.fibonacci",
  () => require("./src/examples/fibonacciRuntimeFunction").fibonacci
);
```

Every runtime loads the same bundle and installs the same registration table.
When the caller invokes a function, native sends:

- the target runtime name
- the stable function id
- JSON-stringified arguments

C++/JSI dispatches to the target runtime, looks up the registered loader,
caches the loaded JS function, calls it with parsed arguments, and serializes the
result back to the caller.

## Supported Shapes

The primary awaitable shape uses `call(fn).on(runtimeName)(...args)`:

```tsx
await call(fibonacci).on("fibonacci-worker-runtime")(38);
```

The primary fire-and-forget shape uses
`schedule(fn).on(runtimeName)(...args)`:

```tsx
await schedule(refreshCache).on("background")("settings");
```

For a fixed-runtime helper, use a top-level function directive:

```tsx
async function sum(a: number, b: number) {
  "background";
  return a + b;
}

await sum(5, 1);
```

The callback form is still supported when you prefer the runtime-first shape.
The callback must contain exactly one call to one exported runtime function:

```tsx
import { usingRuntime } from "@react-native-runtimes/core";

await usingRuntime("fibonacci-worker-runtime").run(() => fibonacci(38));
```

Use an explicit id when the generated file-path id should not be part of your
public API:

```tsx
export const fibonacci = runtimeFunction.named(
  "examples.fibonacci",
  (n: number) => {
    return fibonacciNumber(n);
  }
);
```

Current constraints:

- arguments and return values must be JSON-serializable
- runtime functions must be exported and wrapped in `runtimeFunction`, or use
  the top-level function directive shortcut for awaitable calls
- functions passed to `schedule(...)` must return `void | Promise<void>`
- directive shortcut functions must be declared in module/global scope
- inline lambdas and non-exported functions are not supported
- closures are not captured; pass all inputs as arguments
- directive shortcut functions are rewritten to `const` aliases, so define them
  before calling them
- synchronous functions avoid the extra Promise hop on the target runtime when
  called with `call(...)`
