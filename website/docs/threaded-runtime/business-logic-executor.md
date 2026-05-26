---
id: business-logic-executor
title: Background Thread Architecture
---

Use two JavaScript runtimes for app-lifetime background work:

- `main` renders UI and handles user interaction.
- `background` stays warm and owns sync, caching, queues, parsing, and other
  non-visual work.

The recommended setup is native prewarm plus shared Zustand state. Schedule
functions with a fixed-runtime directive when a function belongs to only one
runtime.

## Native Prewarm

Start the background runtime from native app startup. This keeps the runtime
alive before React screens ask it to do work.

Android:

```kotlin
import com.facebook.react.PackageList
import com.nativecompose.threadedruntime.ThreadedRuntime

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()

    ThreadedRuntime.setMainReactPackagesProvider {
      PackageList(this).packages
    }

    loadReactNative(this)
    ThreadedRuntime.prewarmBusinessRuntime(applicationContext, "background")
  }
}
```

iOS:

```swift
import NativeComposeThreadedRuntime

ThreadedRuntime.configure(
  withReactNativeDelegate: delegate,
  launchOptions: launchOptions
)

ThreadedRuntime.prewarmBusinessRuntime("background")
```

## Background Runtime Entry

Put background-only startup code in a root-level runtime entry file:

```txt
index.background.ts
```

The Metro wrapper discovers files named `index.<runtime>.ts` in the project
root and emits static conditional requires for them. When native starts a
runtime named `background`, the generated threaded entry loads
`index.background.ts` inside that runtime only.

Use this file for module-scope work that must exist before native queues are
flushed:

```tsx title="index.background.ts"
import { runtimeFunction } from "@react-native-runtimes/core";
import { business } from "./src/businessStore";

export const refreshBusiness = runtimeFunction.named(
  "business:refresh",
  async ({ reason }: { reason: string }) => {
    await business.hydrate();
    await business.update((state) => ({
      lastRefreshReason: reason,
      refreshCount: state.refreshCount + 1,
    }));
  }
);

void business.hydrate();
```

Keep UI imports out of `index.background.ts`. Treat it as the background
runtime bootstrap: export named runtime functions, hydrate stores, start
app-lifetime queues, and install background-only listeners.

The file suffix matches the runtime name. If your native prewarm uses a
different name, use that same suffix:

```kotlin
ThreadedRuntime.prewarmBusinessRuntime(applicationContext, "sync-engine")
```

```txt
index.sync-engine.ts
```

## Shared Zustand Store

Put shared state in `@react-native-runtimes/state` so `main` and `background`
can both read and write the same data.

```tsx
import { createSharedStore } from "@react-native-runtimes/state";

type BusinessState = {
  business: BusinessSnapshot;
};

type BusinessSnapshot = {
  lastRefreshReason: string | null;
  refreshCount: number;
};

type BusinessAction = {
  type: "refreshRequested";
  reason: string;
};

export const businessStore = createSharedStore<BusinessState, BusinessAction>({
  name: "business",
  initialState: {
    business: {
      lastRefreshReason: null,
      refreshCount: 0,
    },
  },
  slices: {
    business: (state, action) => {
      if (action.type !== "refreshRequested") {
        return state;
      }

      return {
        lastRefreshReason: action.reason,
        refreshCount: state.refreshCount + 1,
      };
    },
  },
  persist: {
    key: "business-v1",
    subtrees: ["business"],
  },
});

export const business = businessStore.path<BusinessSnapshot>("business");
```

Read it from UI on the main runtime:

```tsx
function BusinessStatus() {
  const state = business.use();

  return <Text>{state.lastRefreshReason ?? "idle"}</Text>;
}
```

## Background Functions

For work that should always run on the background runtime, define the function
in module/global scope and make `'background'` the first statement.

```tsx
async function refreshBusinessState(reason: string) {
  "background";

  await business.hydrate();
  await business.update((state) => ({
    lastRefreshReason: reason,
    refreshCount: state.refreshCount + 1,
  }));

  return business.get();
}

const state = await refreshBusinessState("manual");
```

Metro rewrites that to a registered runtime function and a local scheduled
alias:

```tsx
export const refreshBusinessState_ = runtimeFunction.withId(
  "src/business.refreshBusinessState_",
  async function refreshBusinessState(reason: string) {
    "background";
    // function body
  }
);

const refreshBusinessState = call(refreshBusinessState_).on("background");
```

## Main Runtime Functions

Use `'main'` for functions that should run on the main runtime. This is useful
when background work needs to schedule a small UI-owned state update back to the
main runtime.

```tsx
async function markRefreshVisible(reason: string) {
  "main";

  await business.update((state) => ({
    lastRefreshReason: reason,
    refreshCount: state.refreshCount + 1,
  }));
}

await markRefreshVisible("background-sync-complete");
```

## When To Use This Pattern

Use the two-runtime architecture when the background side has app-lifetime work:

- sync engines
- caches and hydration
- queues
- local search indexing
- document parsing
- crypto orchestration through native modules

Prefer shared Zustand state for progress and results. Avoid passing large
payloads through function arguments; pass ids or storage references instead.
Functions that use `'background'` or `'main'` must be declared at module scope,
so Metro can rewrite and register them before calls are made.

Use `schedule(fn).on(runtimeName)(...args)` for fire-and-forget work that
reports progress through shared state. Use `call(fn).on(runtimeName)(...args)`
when the caller needs a result.
