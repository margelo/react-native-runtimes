# @react-native-runtimes/state

Small native-backed Zustand-style store for React Native runtimes that do not
share a JS heap.

The package includes Android and iOS native code. Serialized state is stored in
a process-wide C++ singleton and exposed through a Nitro HybridObject for
synchronous reads and commits from every React runtime. The classic React Native
module remains as a small event/promise shim so runtimes can be notified after
another runtime commits.

```ts
import { createSharedStore } from '@react-native-runtimes/state';

type CounterAction = { type: 'inc' } | { type: 'reset' };

export const counterStore = createSharedStore({
  name: 'counter',
  initialState: { count: 0 },
  reducer(state, action: CounterAction) {
    switch (action.type) {
      case 'inc':
        return { count: state.count + 1 };
      case 'reset':
        return { count: 0 };
    }
  },
});

counterStore.dispatch({ type: 'inc' });
const count = counterStore.useStore(state => state.count);
```

For shared state that is updated from multiple runtimes, take a native-backed
path handle from the store:

```ts
export const chatStore = createSharedStore({
  name: 'chat',
  initialState: {
    messages: {},
    reactions: {},
    settings: { theme: 'dark' },
  },
});

const messages = chatStore.path<Record<string, Message[]>>('messages');
const releaseRoomMessages = chatStore.path<Message[]>([
  'messages',
  'release-room',
]);
const settings = chatStore.path<{ theme: string }>('settings');

await releaseRoomMessages.update(items => [...(items ?? []), message]);
await settings.set({ theme: 'light' });

const messageCount = releaseRoomMessages.use(items => items?.length ?? 0);
```

Path strings and path arrays both become native keys. Subscribers on related
paths are invalidated together, so a subscriber on `messages` will be notified
when `messages.release-room` changes.

Enable native persistence when state should survive process restart:

```ts
export const preferencesStore = createSharedStore({
  name: 'preferences',
  initialState: {
    counter: { count: 0, updatedAt: null },
  },
  subtrees: ['counter'],
  persist: {
    key: 'preferences',
    version: 1,
    subtrees: ['counter'],
  },
});
```

Hydration uses a native `getOrInit` operation, so concurrent runtimes do not
both observe an empty store and race to write their own initial state. If
persistence is enabled, native storage is checked before the initial state is
committed to the process-wide singleton.

## Runtime model

- State is serialized as JSON at the native boundary.
- Native storage is a C++ singleton keyed by store name and path key.
- JS uses the Nitro `SharedZustandStore` HybridObject when it is available and
  falls back to the classic `SharedZustandStore` native module.
- Each path has its own state payload, revision, and lock.
- Each React runtime receives `SharedZustandStoreChanged` native events.
- Reducers currently run in the JS runtime that calls `dispatch`.
- Path updates should use one writer per path, or `update(...)` when two
  runtimes may update the same path.
- Persisted subtrees are stored as native JSON files and restored during
  hydration before initial state is used.

## Expo

This package does **not** ship its own config plugin. Register it by npm name
through the `packages` option of `@react-native-runtimes/core` — core reads the
`reactNativeRuntimes` metadata declared in this package's `package.json` and
adds `ThreadedZustandPackage` to the secondary runtime's package list:

```ts
// app.config.ts
export default {
  newArchEnabled: true,
  plugins: [
    ['@react-native-runtimes/core', {
      packages: ['@react-native-runtimes/state'],
    }],
  ],
};
```

On iOS no additional setup is needed — the Podspec and NitroModules autolinking
handle everything automatically.

The package does **not** require Expo at runtime.

## Setup

Install the package and let React Native autolink it:

```sh
npm install @react-native-runtimes/state react-native-nitro-modules
```

On iOS, run CocoaPods after install:

```sh
cd ios && pod install
```

For manually wired secondary runtimes, include `ThreadedZustandPackage` in the
package list used to create that runtime:

```kotlin
import com.nativecompose.threadedzustand.ThreadedZustandPackage

ThreadedRuntime.setExtraReactPackagesProvider {
  listOf(ThreadedZustandPackage())
}
```

## Native contract

The fast path expects a Nitro HybridObject named `SharedZustandStore` with:

- `getState(storeName, subtreeKey)`
- `getOrInitState(storeName, subtreeKey, initialJson, persistKey)`
- `setState(storeName, subtreeKey, stateJson)`
- `getRevision(storeName, subtreeKey)`
- `clear(storeName, subtreeKey)`
- `setPersistedState(persistKey, stateJson)`
- `clearPersistedState(persistKey)`

The JS package also expects a classic native module named `SharedZustandStore`
for event broadcast and as a fallback:

- `getState(storeName)`
- `getOrInitState(storeName, initialJson, persistKey)`
- `setState(storeName, stateJson, source)`
- `getRevision(storeName)`
- `clear(storeName, source)`
- `getSubtreeState(storeName, subtreeKey)`
- `getOrInitSubtreeState(storeName, subtreeKey, initialJson, persistKey)`
- `setSubtreeState(storeName, subtreeKey, stateJson, source)`
- `getSubtreeRevision(storeName, subtreeKey)`
- `clearSubtree(storeName, subtreeKey, source)`
- `setPersistedState(persistKey, stateJson)`
- `clearPersistedState(persistKey)`
- `notifyChanged(storeName, subtreeKey, stateJson, revision, source)`

The module emits `SharedZustandStoreChanged` to every active React runtime
after commits. Android and iOS are implemented inside this package.

The next architectural step is a reducer runtime: a non-UI Hermes runtime that
loads the app bundle, registers reducers, receives native actions, and commits
the reduced JSON state back into this singleton. For native-module access from
reducers, that runtime should be a headless RN instance rather than a raw Hermes
runtime.
