---
id: background-work
title: Background Work With Runtime Functions
---

Run background JS on a named threaded runtime by registering a
`runtimeFunction` and invoking it with `schedule`. Scheduled functions do not
return values to the caller; they should publish durable output through shared
state, storage, or native modules.

```tsx
import { runtimeFunction, schedule } from "@react-native-runtimes/core";
import { messagesStore } from "./messagesStore";

export const hydrateConversation = runtimeFunction.named(
  "messages.hydrateConversation",
  async ({
    conversationId,
    limit,
  }: {
    conversationId: string;
    limit: number;
  }) => {
    const messages = await loadMessages(conversationId, limit);

    await messagesStore
      .path<Message[]>(["conversations", conversationId])
      .set(messages, true);
  }
);

await schedule(hydrateConversation).on("conversation-worker-runtime")({
  conversationId: "release-room",
  limit: 50,
});
```

Native starts or reuses the named runtime. If the runtime is still starting,
the function is queued and flushed after startup. The returned JS promise
resolves when native accepts the scheduled work, not when the async function
body finishes.

## Await Results

Use `call` when the caller needs a return value:

```tsx
import { call, runtimeFunction } from "@react-native-runtimes/core";

export const readConversation = runtimeFunction(async ({ conversationId }) => {
  const messages = messagesStore.path<Message[]>([
    "conversations",
    conversationId,
  ]);

  await messages.hydrate();
  return messages.get();
});

const messages = await call(readConversation).on("conversation-worker-runtime")(
  { conversationId: "inbox" }
);
```

## Native Schedule

Native callers schedule explicitly named runtime functions by id.

Android Kotlin:

```kotlin
ThreadedRuntime.schedule(
  context = applicationContext,
  runtimeName = "conversation-worker-runtime",
  functionId = "messages.hydrateConversation",
  argsJson = """[{"conversationId":"release-room","limit":50}]""",
)
```

Android C++:

```cpp
#include <nativecompose/threadedruntime/ThreadedRuntimeDispatcher.h>

nativecompose::threadedruntime::schedule(
  env,
  applicationContext,
  "conversation-worker-runtime",
  "messages.hydrateConversation",
  R"([{"conversationId":"release-room","limit":50}])"
);
```

Apple C++ or Objective-C++:

```cpp
#include <nativecompose/threadedruntime/ThreadedRuntimeDispatcher.h>

nativecompose::threadedruntime::schedule(
  "conversation-worker-runtime",
  "messages.hydrateConversation",
  R"([{"conversationId":"release-room","limit":50}])"
);
```

## Typical Flow

1. Prewarm the runtime while the user is still on the previous screen.
2. Schedule a runtime function to hydrate data on that runtime.
3. Store durable output in shared state or native storage.
4. Open a `ThreadedScreen` using the same runtime name.
5. The screen reads the already-warmed data from the shared store.
