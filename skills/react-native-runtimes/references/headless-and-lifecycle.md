# Headless Tasks and Runtime Lifecycle

Fire-and-forget background work, runtime prewarm/destroy, and the native dispatch APIs that let Kotlin / Swift / C++ drive a runtime before JS is on the stack.

## When to use a headless task vs a runtime function

| Need | Use |
| --- | --- |
| Caller needs the return value or to know when it's done | `runtimeFunction` ([runtime-functions.md](runtime-functions.md)) |
| Fire-and-forget; durable output goes through a shared store, file, or native module | `registerThreadedHeadlessTask` + `ThreadedRuntime.runHeadlessTask` |
| Need to dispatch from native code, possibly before any JS runtime exists | `ThreadedRuntime.dispatchHeadlessTask(...)` from Kotlin/Swift/C++ |

`runHeadlessTask` resolves when native **accepts the dispatch**, not when the handler finishes. If you await it hoping for completion, you have a race. Use `runtimeFunction` if you need request/response.

## Registering and dispatching a headless task

Register the task in code loaded by the threaded bundle — any file under Metro's `roots` works, since the generated entry registers everything. For startup work, put it in a root-level `index.<runtime>.ts` (see below).

```tsx
import { registerThreadedHeadlessTask } from '@react-native-runtimes/core';
import { messagesStore } from './messagesStore';

registerThreadedHeadlessTask<{ conversationId: string; limit: number }>(
  'hydrateConversation',
  async ({ payload, runtimeName }) => {
    const messages = await loadMessages(payload.conversationId, payload.limit);
    await messagesStore
      .path<Message[]>(['conversations', payload.conversationId])
      .set(messages, true);
    console.info(`Hydrated ${payload.conversationId} on ${runtimeName}`);
  },
);
```

Dispatch from JS:

```tsx
import { ThreadedRuntime } from '@react-native-runtimes/core';

await ThreadedRuntime.runHeadlessTask('hydrateConversation', {
  runtimeName: 'conversation-worker-runtime',
  payload: { conversationId: 'release-room', limit: 50 },
});
```

If the runtime is still starting, native queues the task and flushes it after startup. If the runtime doesn't exist yet, native creates and starts it.

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

This file is where background runtime bootstrap belongs: register headless tasks, hydrate stores, install background-only listeners, start app-lifetime queues. **No UI imports** — this code never renders anything.

```tsx title="index.background.ts"
import { registerThreadedHeadlessTask } from '@react-native-runtimes/core';
import { business } from './src/businessStore';

registerThreadedHeadlessTask<{ reason: string }>(
  'business:refresh',
  async ({ payload }) => {
    await business.hydrate();
    await business.update(state => ({
      lastRefreshReason: payload.reason,
      refreshCount: state.refreshCount + 1,
    }));
  },
);

void business.hydrate();
```

## Native dispatch — Kotlin

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

// Headless dispatch — queued if the runtime is still starting; creates the runtime if absent.
ThreadedRuntime.dispatchHeadlessTask(
  context = applicationContext,
  runtimeName = "conversation-worker-runtime",
  taskName = "hydrateConversation",
  payloadJson = """{"conversationId":"release-room","limit":50}""",
)

// Package providers — install once at app startup, before any threaded surface.
ThreadedRuntime.setExtraReactPackagesProvider { listOf(/* curated packages for threaded runtimes */) }
ThreadedRuntime.setMainReactPackagesProvider { PackageList(this).packages }   // for business runtimes that mirror main
```

## Native dispatch — Swift (iOS)

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

// Headless dispatch — queued if not ready; creates the runtime if absent.
ThreadedRuntime.dispatchHeadlessTask(
  withRuntimeName: "conversation-worker-runtime",
  taskName: "hydrateConversation",
  payloadJson: #"{"conversationId":"release-room","limit":50}"#
)
```

iOS uses the configured RN delegate for native module lookup on threaded runtimes — no separate package provider needed, but `configure(...)` must run early.

## Native dispatch — C++

```cpp
#include <nativecompose/threadedruntime/ThreadedRuntimeDispatcher.h>

// Prewarm — create and start a named runtime from native code.
// Apple (no JNI env / context):
nativecompose::threadedruntime::prewarmRuntime("conversation-worker-runtime");

// Android (needs JNIEnv* + the Application context):
nativecompose::threadedruntime::prewarmRuntime(env, applicationContext, "conversation-worker-runtime");

// Headless dispatch — queued if the runtime is still starting; creates the runtime if absent.
// Apple:
nativecompose::threadedruntime::dispatchHeadlessTask(
  "conversation-worker-runtime",
  "hydrateConversation",
  R"({"conversationId":"release-room","limit":50})"
);

// Android:
nativecompose::threadedruntime::dispatchHeadlessTask(
  env,
  applicationContext,
  "conversation-worker-runtime",
  "hydrateConversation",
  R"({"conversationId":"release-room","limit":50})"
);
```

## Typical flow

A common pattern that combines all of this:

1. **At app startup**, prewarm an app-lifetime business/background runtime from native code (`prewarmBusinessRuntime`).
2. **In that runtime's `index.<runtime>.ts`**, register headless tasks and hydrate shared stores.
3. **From the main runtime**, dispatch headless tasks for background hydration before opening a screen.
4. **Mount the screen** via `ThreadedScreen` — it reuses the runtime that was prewarmed; the data it reads through shared paths is already hydrated.

```tsx
async function prepareAndOpen(conversationId: string) {
  const runtimeName = `conversation-${conversationId}-runtime`;
  await ThreadedRuntime.prewarm(runtimeName);
  await ThreadedRuntime.runHeadlessTask('hydrateConversation', {
    runtimeName,
    payload: { conversationId, limit: 50 },
  });
  navigation.navigate('Conversation', { conversationId });
}
```

## Constraints

- `runHeadlessTask` returns on **dispatch**, not completion. Pass durable output through shared state, native storage, or native modules.
- A headless task body cannot reach back into the caller through closures. Captured variables resolve against the *target* runtime's module evaluation, not the caller's.
- Native dispatches queue if the runtime is still starting; they create + start the runtime if it doesn't exist.
- Each named runtime keeps its bundle, native modules, and subscriptions resident until you destroy it. Pool by logical owner, don't spin one up per task.

## Related

- When you need a return value from the task, not just a dispatch → [runtime-functions.md](runtime-functions.md)
- Mount UI on a runtime once it's prewarmed → [rendering-components.md](rendering-components.md)
- Durable output from headless tasks goes through shared paths → [shared-state.md](shared-state.md)
- Setting up the Android `setExtraReactPackagesProvider` / iOS `configure` that lifecycle calls depend on → [quickstart.md](quickstart.md)
- Symptoms: `runHeadlessTask` resolves but the body hasn't run; renaming a runtime didn't free the old one → [gotchas.md](gotchas.md)
