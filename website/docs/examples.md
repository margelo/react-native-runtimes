---
id: examples
title: Examples
---

## Fibonacci Runtime Function

Use a runtime function when the caller should await a result from another JS
runtime:

```tsx
import { call, runtimeFunction } from "@react-native-runtimes/core";

function fibonacciNumber(n: number): number {
  if (n < 2) {
    return n;
  }

  return fibonacciNumber(n - 1) + fibonacciNumber(n - 2);
}

export const fibonacci = runtimeFunction((n: number) => {
  return {
    input: n,
    result: fibonacciNumber(n),
    computedAt: new Date().toISOString(),
  };
});

const result = await call(fibonacci).on("fibonacci-worker-runtime")(38);
```

The sample app includes this as the **Fibonacci** screen. It is the smallest
example of scheduling work on a named runtime and awaiting the result.

## LegendList On A Separate Runtime

Use a threaded surface when a whole React component should render away from the
main runtime. Pass identity through props, then read the large data set directly
inside the threaded runtime:

```tsx
function MessageList({ conversationId }: { conversationId: string }) {
  const messages = useDatabaseQuery(() =>
    db.messages
      .where("conversationId")
      .equals(conversationId)
      .sortBy("createdAt")
  );

  return (
    <LegendList
      data={messages}
      estimatedItemSize={96}
      keyExtractor={(item) => item.id}
      renderItem={renderMessage}
    />
  );
}

<OnRuntime name="messages-runtime">
  <MessageList conversationId="release-room" />
</OnRuntime>;
```

Metro treats the direct child of `OnRuntime` as a threaded boundary and
registers it in the generated threaded entry. Native mounts
`ThreadedRuntimeHost` in `messages-runtime`, and that runtime renders the list.
The main runtime does not serialize the message array; it only passes the
conversation id.

The sample app includes this as **Legend 2RN**.

## Producer And Consumer

Use the main runtime as a data producer and a threaded runtime as the consumer
when network and UI ownership are separate:

```tsx
const pokemonItems = pokemonStore.path<PokemonEntry[]>("pokemonItems");

async function fetchMore() {
  const page = await fetchNextPage();

  await pokemonItems.update((items) => [...items, ...page]);
}
```

The threaded runtime subscribes to the shared path:

```tsx
function PokemonConsumer() {
  const items = pokemonItems.use();

  return <FlatList data={items} renderItem={renderPokemon} />;
}

<OnRuntime name="pokemon-runtime">
  <PokemonConsumer />
</OnRuntime>;
```

The sample app includes this as **PokeAPI shared runtime feed**.

## Shared State With Trees

Use shared Zustand paths when two runtimes should update the same logical state:

```tsx
const sharedTreeStore = createSharedStore<SharedTreeState>({
  name: "threaded-tree-demo",
  initialState: {
    nodes: initialNodeColors,
    interaction: {
      lastNode: "root",
      lastRuntime: "initial",
      presses: 0,
    },
  },
  subtrees: ["nodes", "interaction"],
});

const nodes = sharedTreeStore.path<SharedTreeState["nodes"]>("nodes");
const interaction =
  sharedTreeStore.path<SharedTreeState["interaction"]>("interaction");
```

Both runtimes render the same tree and write through path handles:

```tsx
function SharedTreePanel({ runtimeLabel }: { runtimeLabel: string }) {
  const nodeColors = nodes.use();
  const currentInteraction = interaction.use();

  async function pressNode(nodeId: SharedTreeNodeId) {
    await nodes.set({
      ...nodeColors,
      [nodeId]: nextColor(nodeColors[nodeId]),
    });
    await interaction.set({
      lastNode: nodeId,
      lastRuntime: runtimeLabel,
      presses: currentInteraction.presses + 1,
    });
  }

  return <Tree nodes={nodeColors} onPressNode={pressNode} />;
}

<SharedTreePanel runtimeLabel="main RN" />

<OnRuntime name="shared-tree-runtime">
  <SharedTreePanel runtimeLabel="threaded RN" />
</OnRuntime>;
```

The sample app includes this as **Shared tree**.

## Chat Screen On A Secondary Runtime

```tsx
const CHAT_RUNTIME_NAMES = conversations.map(
  (conversation) => `conversation-${conversation.id}-runtime`
);

function ConversationPicker() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId != null) {
      return;
    }

    for (const runtimeName of CHAT_RUNTIME_NAMES) {
      void ThreadedRuntime.prewarm(runtimeName);
    }
  }, [selectedId]);

  if (selectedId) {
    return (
      <ThreadedScreen
        component={ConversationScreen}
        props={{ conversationId: selectedId }}
        runtimeName={`conversation-${selectedId}-runtime`}
      />
    );
  }

  return (
    <ConversationList
      onOpen={(conversationId) => {
        void ThreadedRuntime.prewarm(`conversation-${conversationId}-runtime`);
        setSelectedId(conversationId);
      }}
    />
  );
}
```

## Scheduled Hydration Before Opening A Screen

```tsx
import { schedule } from "@react-native-runtimes/core";
import { hydrateConversation } from "./hydrateConversation";

async function prepareAndOpen(conversationId: string) {
  const runtimeName = `conversation-${conversationId}-runtime`;

  await ThreadedRuntime.prewarm(runtimeName);
  await schedule(hydrateConversation).on(runtimeName)({
    conversationId,
    limit: 50,
  });

  navigation.navigate("Conversation", { conversationId });
}
```

## Native Queued Dispatch

This can be called before the runtime is ready. Native queues the request and
flushes it once startup completes.

```kotlin
ThreadedRuntime.schedule(
  applicationContext,
  "conversation-release-room-runtime",
  "messages.hydrateConversation",
  """[{"conversationId":"release-room","limit":50}]""",
)
```

## Run The Example App

Android:

```sh
npm install
npm run android
```

iOS:

```sh
npm install
cd ios
bundle exec pod install
cd ..
npm run ios
```

The sample app includes:

- Fibonacci runtime function.
- FlashList and LegendList on a threaded runtime.
- Main-runtime LegendList comparison.
- PokeAPI producer on main runtime and consumer on a threaded runtime.
- Shared tree state across runtimes.
- Threaded chat screen and chat app examples.
