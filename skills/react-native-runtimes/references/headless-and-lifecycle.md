# Background Work and Runtime Lifecycle

Fire-and-forget background work, runtime prewarm/destroy, and the native dispatch APIs that let Kotlin / Swift / C++ drive a runtime before JS is on the stack.

## When to use `schedule` vs `call`

Both run a registered `runtimeFunction` on a named runtime. They differ in whether the caller gets a result back.

| Need | Use |
| --- | --- |
| Caller needs the return value or to know when it's done | `call(fn).on(runtimeName)(...args)` ([runtime-functions.md](runtime-functions.md)) |
| Fire-and-forget; durable output goes through a shared store, file, or native module | `schedule(fn).on(runtimeName)(...args)` |
| Need to schedule from native code, possibly before any JS runtime exists | `ThreadedRuntime.schedule(...)` from Kotlin/Swift/C++ |

`schedule` resolves when native **accepts the work**, not when the function body finishes. If you await it hoping for completion, you have a race. Use `call` if you need request/response. `schedule(...)` only accepts runtime functions that return `void | Promise<void>`.

## Registering and scheduling a runtime function

Define the function in code loaded by the threaded bundle — any file under Metro's `roots` works, since the generated entry registers everything. For startup work, put it in a root-level `index.<runtime>.ts` (see below). Give it a stable id with `runtimeFunction.named(...)` so native callers can reference it:

```tsx
import { runtimeFunction } from '@react-native-runtimes/core';
import { messagesStore } from './messagesStore';

export const hydrateConversation = runtimeFunction.named(
  'hydrateConversation',
  async ({ conversationId, limit }: { conversationId: string; limit: number }) => {
    const messages = await loadMessages(conversationId, limit);
    await messagesStore
      .path<Message[]>(['conversations', conversationId])
      .set(messages, true);
  },
);
```

Schedule from JS:

```tsx
import { schedule } from '@react-native-runtimes/core';
import { hydrateConversation } from './hydrateConversation';

await schedule(hydrateConversation).on('conversation-worker-runtime')({
  conversationId: 'release-room',
  limit: 50,
});
```

If the runtime is still starting, native queues the work and flushes it after startup. If the runtime doesn't exist yet, native creates and starts it.

## Runtime lifecycle (JS)

```tsx
await ThreadedRuntime.prewarm(name, options?);  // create + start the runtime; load the bundle; don't mount a surface
await ThreadedRuntime.preload(name);            // alias for prewarm
await ThreadedRuntime.destroy(name);            // tear down the runtime; release bundle/modules/subscriptions
await ThreadedRuntime.destroyAll();             // tear down every named runtime
const names = await ThreadedRuntime.getRuntimeNames();  // string[] of active runtimes
```

`prewarm` options: `{ kind?: string, useMainNativeModules?: boolean }`. `kind` shows up in `global.__THREADED_RUNTIME_ENV__.kind` inside the runtime and is what `index.<runtime>.ts` discovery matches on.

Prewarm aggressively. A cold runtime + bundle parse is hundreds of ms; warm prewarm is cheap. Patterns:
- While a picker/list is on screen, `void ThreadedRuntime.prewarm(`conversation-${id}-runtime`)` for likely-next routes.
- On `onPressIn`, prewarm again before the screen transition — no-op if already warm.
- `ThreadedScreen` preloads its own runtime via a React effect; explicit prewarm before mount usually saves the bundle-load hop.

Destroy when an owner is gone (signed-out user, closed conversation pool). For ephemeral routes, `<ThreadedScreen destroyOnUnmount />`. For routes the user re-enters (chat threads, tabs), do NOT use `destroyOnUnmount` — re-entry pays the bundle-load cost again.

## Background-only startup — `index.<runtime>.ts`

The Metro wrapper scans the project root for files named `index.<runtime>.ts` and emits static conditional requires in the generated entry, gated on `global.__THREADED_RUNTIME_ENV__.kind` and `.runtimeName`.

```txt
index.background.ts             // loaded only when kind === 'background' or runtimeName === 'background'
index.business-runtime.ts
index.sync-engine.ts
```

This file is where background runtime bootstrap belongs: register runtime functions, hydrate stores, install background-only listeners, start app-lifetime queues. **No UI imports** — this code never renders anything.

```tsx title="index.background.ts"
import { runtimeFunction } from '@react-native-runtimes/core';
import { business } from './src/businessStore';

export const refreshBusiness = runtimeFunction.named(
  'business:refresh',
  async ({ reason }: { reason: string }) => {
    await business.hydrate();
    await business.update(state => ({
      lastRefreshReason: reason,
      refreshCount: state.refreshCount + 1,
    }));
  },
);

void business.hydrate();
```

## Native schedule — Kotlin

```kotlin
import com.nativecompose.threadedruntime.ThreadedRuntime

// Lifecycle
ThreadedRuntime.prewarmRuntime(applicationContext, "background")
ThreadedRuntime.prewarmRuntimeWithOptions(applicationContext, "name", kind, useMainNativeModules)
ThreadedRuntime.prewarmBusinessRuntime(applicationContext, "business-runtime")
ThreadedRuntime.preloadRuntime(applicationContext, "name")   // alias for prewarmRuntime
ThreadedRuntime.destroyRuntime(applicationContext, "name")
ThreadedRuntime.destroyAllRuntimes(applicationContext)
ThreadedRuntime.getRuntimeNames(applicationContext)   // List<String>

// Schedule — queued if the runtime is still starting; creates the runtime if absent.
// argsJson is a JSON array of the function's arguments.
ThreadedRuntime.schedule(
  context = applicationContext,
  runtimeName = "conversation-worker-runtime",
  functionId = "hydrateConversation",
  argsJson = """[{"conversationId":"release-room","limit":50}]""",
)

// Package providers — install once at app startup, before any threaded surface.
ThreadedRuntime.setExtraReactPackagesProvider { listOf(/* curated packages for threaded runtimes */) }
ThreadedRuntime.setMainReactPackagesProvider { PackageList(this).packages }   // for business runtimes that mirror main
```

## Native schedule — Swift (iOS)

```swift
import NativeComposeThreadedRuntime

// Required once, before the first surface. Put this in AppDelegate.
ThreadedRuntime.configure(
  withReactNativeDelegate: delegate,
  launchOptions: launchOptions
)

// Lifecycle
ThreadedRuntime.prewarmRuntime("name")
ThreadedRuntime.prewarmBusinessRuntime("business-runtime")
ThreadedRuntime.destroyRuntime("name")
ThreadedRuntime.destroyAllRuntimes()

// Schedule — queued if not ready; creates the runtime if absent.
// argsJson is a JSON array of the function's arguments.
ThreadedRuntime.schedule(
  withRuntimeName: "conversation-worker-runtime",
  functionId: "hydrateConversation",
  argsJson: #"[{"conversationId":"release-room","limit":50}]"#
)
```

iOS uses the configured RN delegate for native module lookup on threaded runtimes — no separate package provider needed, but `configure(...)` must run early.

## Native schedule — C++

```cpp
#include <nativecompose/threadedruntime/ThreadedRuntimeDispatcher.h>

// Prewarm — create and start a named runtime from native code.
// Apple (no JNI env / context):
nativecompose::threadedruntime::prewarmRuntime("conversation-worker-runtime");

// Android (needs JNIEnv* + the Application context):
nativecompose::threadedruntime::prewarmRuntime(env, applicationContext, "conversation-worker-runtime");

// Schedule — queued if the runtime is still starting; creates the runtime if absent.
// The last argument is a JSON array of the function's arguments.
// Apple:
nativecompose::threadedruntime::schedule(
  "conversation-worker-runtime",
  "hydrateConversation",
  R"([{"conversationId":"release-room","limit":50}])"
);

// Android:
nativecompose::threadedruntime::schedule(
  env,
  applicationContext,
  "conversation-worker-runtime",
  "hydrateConversation",
  R"([{"conversationId":"release-room","limit":50}])"
);
```

## Typical flow

A common pattern that combines all of this:

1. **At app startup**, prewarm an app-lifetime business/background runtime from native code (`prewarmBusinessRuntime`).
2. **In that runtime's `index.<runtime>.ts`**, register runtime functions and hydrate shared stores.
3. **From the main runtime**, schedule runtime functions for background hydration before opening a screen.
4. **Mount the screen** via `ThreadedScreen` — it reuses the runtime that was prewarmed; the data it reads through shared paths is already hydrated.

```tsx
async function prepareAndOpen(conversationId: string) {
  const runtimeName = `conversation-${conversationId}-runtime`;
  await ThreadedRuntime.prewarm(runtimeName);
  await schedule(hydrateConversation).on(runtimeName)({
    conversationId,
    limit: 50,
  });
  navigation.navigate('Conversation', { conversationId });
}
```

## Constraints

- `schedule` returns on **dispatch**, not completion. Pass durable output through shared state, native storage, or native modules.
- `schedule(...)` only accepts runtime functions that return `void | Promise<void>`. Use `call(...)` when you need a return value.
- A scheduled function body cannot reach back into the caller through closures. Captured variables resolve against the *target* runtime's module evaluation, not the caller's.
- Native schedules queue if the runtime is still starting; they create + start the runtime if it doesn't exist.
- Each named runtime keeps its bundle, native modules, and subscriptions resident until you destroy it. Pool by logical owner, don't spin one up per call.

## Related

- When you need a return value from the function, not just a dispatch → [runtime-functions.md](runtime-functions.md)
- Mount UI on a runtime once it's prewarmed → [rendering-components.md](rendering-components.md)
- Durable output from scheduled functions goes through shared paths → [shared-state.md](shared-state.md)
- Setting up the Android `setExtraReactPackagesProvider` / iOS `configure` that lifecycle calls depend on → [quickstart.md](quickstart.md)
- Symptoms: `schedule` resolves but the body hasn't run; renaming a runtime didn't free the old one → [gotchas.md](gotchas.md)
