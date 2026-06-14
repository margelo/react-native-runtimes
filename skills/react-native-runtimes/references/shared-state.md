# Shared State — `@react-native-runtimes/state`

A Zustand-flavored API on top of a C++ singleton. Two runtimes can read and write the same JSON-shaped state without prop-drilling or hand-rolled IPC. Native broadcasts change events to every active runtime.

## Create a store

```ts
import { createSharedStore } from '@react-native-runtimes/state';

type ChatState = {
  conversations: Record<string, Message[]>;
  metadata: Record<string, { title: string; unreadCount: number }>;
};

export const chatStore = createSharedStore<ChatState>({
  name: 'chat',                          // unique store name (required)
  initialState: { conversations: {}, metadata: {} },
  subtrees: ['metadata'],                // eager-hydrate these top-level keys at store creation
  persist: {                              // optional: native persistence
    key: 'chat-v1',
    subtrees: ['metadata'],
    version: 1,
  },
});
```

Options:
- `name` — store identifier. Required. Different stores must have different names.
- `initialState` — JSON-serializable starting state.
- `subtrees` — top-level keys to **eagerly hydrate** when the store is created. Use for small slices the app always needs at startup (theme, current user, feature flags). **Do not list a dynamic-id bucket like `'conversations'`** — that eagerly hydrates every nested id, so a store with hundreds of conversations pays the full deserialization cost at launch.
- `persist.key` — native storage key.
- `persist.subtrees` — which paths get persisted to disk and restored during hydration.
- `persist.version` — bump to force a discard of stale on-disk state (no built-in migrations).
- `slices` — optional reducer functions, one per top-level subtree.
- `reducer` — single root reducer.

Hydration uses a native atomic `getOrInit` — concurrent runtimes never both observe an empty store and race to write defaults.

## Path handles — the recommended API

```ts
const messages = chatStore.path<Message[]>(['conversations', conversationId]);
// Path can also be a dot string: chatStore.path<Message[]>(`conversations.${conversationId}`)
```

The path is the native key. Path strings and arrays both resolve to the same key.

### Async — these wait for the native commit

```ts
await messages.set(value, broadcast?);          // commit; broadcast=true by default
await messages.update(prev => [...(prev ?? []), newMessage]);   // atomic read-modify-write
await messages.hydrate();                        // ensure native value is loaded
await messages.clear();                          // remove this path
```

### Synchronous — these return immediately, do NOT await

```ts
const snapshot = messages.get();                 // current snapshot (no Promise)
const list = messages.use();                     // React hook (subscribes; sync render value)
const count = messages.use(v => v?.length ?? 0); // with selector
const rev = messages.getRevision();              // native revision counter
```

`get()` and `getRevision()` read the in-process C++ snapshot synchronously. `use()` is a React hook — it reads the snapshot during render and re-renders on commit. None of them return Promises. **Don't write `await messages.get()`** — awaiting a plain value unwraps it (a no-op) and hides the fact that a future API change to make it async would not surface as a type error at the call site.

## Reducer API (legacy, still supported)

If you configured `reducer` or `slices` on the store, dispatch actions through the top-level store API:

```ts
await store.dispatch(action);                       // run the root reducer (or, with slices, the matching slice)
await store.dispatchSubtree(subtreeKey, action);    // explicitly target one slice
const value = store.useStore(selector?);            // React hook — subscribes to whole-store state
```

`dispatch` runs the reducer in the JS runtime that calls it and commits the result into the C++ singleton; every active runtime receives the broadcast and re-renders subscribed components.

Prefer the path-handle API (`store.path(...).set` / `.update` / `.use`) for new code — it is more granular, avoids broadcasting the entire store shape on every write, and does not require defining a reducer. Use `dispatch` / `useStore` when integrating with existing Redux-style action flows or when migrating code that already depends on this shape.

## Two writers — use `update`, not `set`

```ts
// Wrong — racey if two runtimes can write:
const current = messages.get();
await messages.set([...current, newMessage]);

// Right — native applies the function atomically:
await messages.update(prev => [...(prev ?? []), newMessage]);
```

Rule of thumb: if only one runtime writes a given path, `set` is fine. If two or more can, always `update`.

## Reading in React

`path.use()` is the hook. It subscribes the component to changes on that path and returns the current snapshot during render.

```tsx
function Conversation({ conversationId }: { conversationId: string }) {
  const messages = chatStore
    .path<Message[]>(['conversations', conversationId])
    .use(value => value ?? []);
  return <MessageList messages={messages} />;
}
```

The selector form (`use(v => derived)`) is the right tool when you only need a derived value — it lets the path tree decide that a write didn't actually change the derived result and skip the re-render.

## Subscriber cascade

Subscribers on related paths are invalidated **in both directions**:
- A subscriber on `conversations.release-room` sees changes to `conversations` (ancestor write).
- A subscriber on `conversations` sees changes to `conversations.release-room` (descendant write).

This is usually what you want — `chatStore.path('conversations').use()` picks up every conversation update. But it also means a hot ancestor subscription re-renders on every leaf write. Prefer narrow paths or selector-form subscriptions.

## No cross-path transactions

Two writes are two events. A subscriber may observe one but not the other yet.

```ts
await metadata.set({ updatedAt: now });   // commit A
await messages.set(newMessages);          // commit B
// A reader on both can render between A and B with an inconsistent view.
```

For atomic groups, store the related fields together at a single composite path, or design consumers to tolerate brief mismatch.

## Persistence

`persist.subtrees` lists paths to restore during store creation. Dynamic paths that aren't listed still hydrate lazily when the handle is first subscribed, or when you call `path.hydrate()` explicitly.

Persisted state is stored as native JSON files keyed by `persist.key` + subtree path. If `persist.version` is bumped and the on-disk version differs, the old payload is discarded and `initialState` takes over (no built-in migration — write a one-shot reducer if you need one).

## Where the data actually lives

- **JSON in a process-wide C++ singleton** keyed by store name + path key.
- **JS layer uses the Nitro `SharedZustandStore` HybridObject** when available; falls back to the classic native module otherwise.
- **Native broadcasts** `SharedZustandStoreChanged` events to every active React runtime after a commit.
- **Reducers** currently run in whichever JS runtime called `dispatch`. Path updates and `update(...)` are the recommended write APIs.
- **Persisted subtrees** are restored from native JSON before initial state is committed, so a hot reload or process restart resumes the same value.

## Constraints

- Values must be **JSON-serializable** (same constraint as runtime function args). `Date`, `Map`, `Set`, class instances, refs, `BigInt`, circular refs all fail.
- `name` is required and must be unique across stores.
- `subtrees` should be top-level keys with **fixed, known names** — not dynamic-id buckets.
- `set(snapshot)` clobbers concurrent writes; use `update(...)` when two runtimes can write the same path.
- Path subscribers cascade in both directions; pick narrow paths for hot subscriptions.
- Sync methods (`get` / `use` / `getRevision`) return immediately — don't `await` them.
- No transactions across paths — group atomically related fields under one composite path.

## Common patterns

### Dynamic per-id state

```ts
export const conversationMessages = (conversationId: string) =>
  chatStore.path<Message[]>(['conversations', conversationId]);

await conversationMessages('release-room').update(prev => [...(prev ?? []), msg]);
```

### Producer / consumer across runtimes

Main runtime fetches, threaded runtime renders:

```ts
async function fetchMore() {
  const page = await fetchNextPage();
  await pokemonItems.update(items => [...(items ?? []), ...page]);
}

// Inside the threaded runtime:
function PokemonConsumer() {
  const items = pokemonItems.use(v => v ?? []);
  return <FlatList data={items} renderItem={renderPokemon} />;
}
```

### Persisted preferences

```ts
export const preferencesStore = createSharedStore({
  name: 'preferences',
  initialState: { counter: { count: 0, updatedAt: null } },
  subtrees: ['counter'],
  persist: { key: 'preferences-v1', subtrees: ['counter'] },
});
```

## Related

- Pass an id through props and read the data from a shared path on the other side → [rendering-components.md](rendering-components.md)
- Reading shared paths from inside a `runtimeFunction` (the "shared state instead of closure capture" fix) → [runtime-functions.md](runtime-functions.md)
- Background runtime hydrating a store before a screen opens → [headless-and-lifecycle.md](headless-and-lifecycle.md)
- Migrating from `useSharedValue` / `runOnJS` to path handles → [migration.md](migration.md)
- Symptoms: subscriber re-renders too often, `set` clobbering concurrent writes, `await path.get()` weirdness → [gotchas.md](gotchas.md)
