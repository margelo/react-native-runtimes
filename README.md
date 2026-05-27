<div align="center">

<img src="https://szymon20000.github.io/react-native-runtimes/img/logo.svg" width="96" alt="react-native-runtimes logo" />

# react-native-runtimes

**True multi-runtime React Native — offload UI and logic to isolated Hermes instances**

[![React Native](https://img.shields.io/badge/React%20Native-0.76%2B-61DAFB?style=flat-square&logo=react)](https://reactnative.dev)
[![New Architecture](https://img.shields.io/badge/New%20Architecture-required-brightgreen?style=flat-square)](https://reactnative.dev/docs/the-new-architecture/landing-page)
[![Expo](https://img.shields.io/badge/Expo-config%20plugin-000020?style=flat-square&logo=expo)](https://expo.dev)
[![Android](https://img.shields.io/badge/Android-supported-3DDC84?style=flat-square&logo=android)](https://developer.android.com)
[![iOS](https://img.shields.io/badge/iOS-supported-000000?style=flat-square&logo=apple)](https://developer.apple.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[📖 Docs](https://szymon20000.github.io/react-native-runtimes/) · [📦 Core Package](packages/core/README.md) · [🗂 State Package](packages/state/README.md)

</div>

---

## What is this?

React Native runs your entire JavaScript product on a single Hermes VM. One slow component, one heavy reducer, one large list — and your whole UI stutters.

**react-native-runtimes** gives you a first-class API to spin up named secondary Hermes runtimes, mount React components inside them, share state across the JS heap boundary, and dispatch work to any runtime from anywhere — all with zero glue code.

```tsx
// That's it. This component now renders in its own Hermes instance.
<OnRuntime name="chat-runtime">
  <MessageList conversationId={conversationId} />
</OnRuntime>
```

---

## Why secondary runtimes?

| Problem | With react-native-runtimes |
|---|---|
| Heavy list blocks UI thread | Render inside an isolated runtime — main JS stays free |
| Business logic competes with animation | Move reducers / stores to a dedicated runtime |
| Chat screen janks on navigation | Prewarm the runtime *before* the user taps |
| Background hydration blocks render | Dispatch headless tasks to a worker runtime |
| State sync across runtimes is painful | Native C++ singleton — reads are synchronous, no bridge round-trip |

---

## Packages

| Package | Description |
|---|---|
| [`@react-native-runtimes/core`](packages/core/README.md) | Mount React components in secondary runtimes. Metro transform, `OnRuntime`, `ThreadedScreen`, headless tasks, cross-runtime function calls. |
| [`@react-native-runtimes/state`](packages/state/README.md) | Zustand-style shared store backed by a process-wide C++ singleton. Synchronous reads and commits from every runtime. |

---

## Feature Highlights

### 🧵 Zero-boilerplate threaded components

Wrap a component in `OnRuntime` — Metro rewrites the JSX to a registered threaded boundary at build time. No manual registration required.

```tsx
import { OnRuntime } from '@react-native-runtimes/core';

<OnRuntime name="feed-runtime">
  <HeavyFeedList userId={userId} />
</OnRuntime>
```

### 📱 Full-screen threaded routes

For navigation flows that should live entirely on a secondary runtime:

```tsx
import { ThreadedScreen, threadedComponent } from '@react-native-runtimes/core';

export const ConversationScreen = threadedComponent<Props>(
  'ConversationScreen',
  (props) => <ConversationRoute {...props} />,
);

// In your navigator:
<ThreadedScreen
  component={ConversationScreen}
  props={{ conversationId }}
  runtimeName={`chat-${conversationId}`}
/>
```

### ⚡ Runtime prewarming

Start the runtime before the user navigates so there is no cold-start lag:

```tsx
import { ThreadedRuntime } from '@react-native-runtimes/core';

// e.g. when the inbox row becomes visible
await ThreadedRuntime.prewarm(`chat-${conversationId}`);
```

### 🏃 Headless tasks

Run JS on a named runtime without mounting a view — perfect for pre-hydrating stores, decoding data, or running reducers in a long-lived worker:

```tsx
// Register on the threaded bundle side:
registerThreadedHeadlessTask('hydrateConversation', async ({ payload }) => {
  const messages = await loadMessages(payload.conversationId, payload.limit);
  await messagesStore.setSubtreeState(payload.conversationId, messages, true);
});

// Dispatch from anywhere:
await ThreadedRuntime.runHeadlessTask('hydrateConversation', {
  runtimeName: 'chat-worker-runtime',
  payload: { conversationId, limit: 50 },
});
```

### 🔀 Cross-runtime function calls

Call a typed function on a specific runtime and await the result — arguments and return values are JSON-serialized automatically:

```tsx
import { call, runtimeFunction } from '@react-native-runtimes/core';

export const fibonacci = runtimeFunction((n: number) => ({
  input: n,
  result: fibonacciNumber(n),
  computedAt: new Date().toISOString(),
}));

// Call it on a named runtime from the main runtime:
const result = await call(fibonacci).on('fibonacci-worker-runtime')(38);
```

Or use a function directive for fixed-runtime helpers — Metro rewrites the call site automatically:

```tsx
async function refreshCache(key: string) {
  'background'; // ← directive: this function always runs on 'background' runtime
  await cacheStore.hydrate();
  return cacheStore.get(key);
}

const value = await refreshCache('settings'); // cross-runtime, no extra API
```

### 🗂 Shared state — synchronous, cross-heap

A Zustand-style API backed by a native C++ process-wide singleton. Reads are synchronous. No bridge round-trip. Any runtime can write and every subscriber is notified.

```tsx
import { createSharedStore } from '@react-native-runtimes/state';

export const chatStore = createSharedStore({
  name: 'chat',
  initialState: { messages: {}, settings: { theme: 'dark' } },
});

// Path handles for fine-grained subscriptions:
const roomMessages = chatStore.path<Message[]>(['messages', 'release-room']);

await roomMessages.update(items => [...(items ?? []), newMessage]);

// Subscribe with a selector — works in any runtime:
const count = roomMessages.use(items => items?.length ?? 0);
```

Add native persistence with a single option:

```tsx
export const preferencesStore = createSharedStore({
  name: 'preferences',
  initialState: { counter: { count: 0 } },
  persist: { key: 'preferences', version: 1, subtrees: ['counter'] },
});
```

### 🏗 Business runtimes

For an app-lifetime runtime that sees the same native modules as the main runtime, use `prewarmBusinessRuntime`:

```kotlin
ThreadedRuntime.setMainReactPackagesProvider { PackageList(this).packages }
ThreadedRuntime.prewarmBusinessRuntime(applicationContext, "business-runtime")
```

```tsx
if (global.__THREADED_RUNTIME_ENV__?.kind === 'business-runtime') {
  require('./src/businessRuntimeEntry');
}
```

### 🔌 Expo support

`@react-native-runtimes/core` ships a config plugin. No manual native edits needed:

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

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  React Native App                │
│                                                  │
│  ┌─────────────────┐   ┌────────────────────┐   │
│  │  Main JS Runtime│   │ Secondary Runtimes │   │
│  │  (Hermes)       │   │                    │   │
│  │                 │   │  ┌──────────────┐  │   │
│  │  <App />        │   │  │ chat-runtime │  │   │
│  │  <Navigator />  │◄──┤  │ <MessageList>│  │   │
│  │                 │   │  └──────────────┘  │   │
│  │                 │   │  ┌──────────────┐  │   │
│  │                 │   │  │ feed-runtime │  │   │
│  │                 │   │  │ <FeedList /> │  │   │
│  │                 │   │  └──────────────┘  │   │
│  └────────┬────────┘   └────────┬───────────┘   │
│           │                     │               │
│  ┌────────▼─────────────────────▼───────────┐   │
│  │       Native C++ State Singleton         │   │
│  │   (SharedZustandStore — synchronous)     │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

---

## Getting Started

### 1. Install





```sh
npm install @react-native-runtimes/core @react-native-runtimes/state react-native-nitro-modules
```

### 2. Configure Metro

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withThreadedRuntime } = require('@react-native-runtimes/core/metro');

module.exports = withThreadedRuntime(
  mergeConfig(getDefaultConfig(__dirname), {}),
  { roots: ['App.tsx', 'src'], generatedDir: '.threaded-runtime' },
);
```

### 3. Load the generated entry

```js
// index.js
if (global.__THREADED_RUNTIME_ENV__) {
  require('./.threaded-runtime/entry');
} else {
  require('./App');
}
```

### 4. Render

```tsx
import { OnRuntime } from '@react-native-runtimes/core';

export default function App() {
  return (
    <OnRuntime name="my-runtime">
      <HeavyComponent />
    </OnRuntime>
  );
}
```

→ Full setup guide: [packages/core/README.md](packages/core/README.md)

---

## Running the Example App

```sh
npm install
npm run android
# or
npm run ios
```

Release smoke-test build:

```sh
cd android
./gradlew :app:assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

---

## Requirements

- React Native **0.76+** (New Architecture required)
- Hermes JS engine
- Android or iOS

---

## Documentation

- 📖 [Hosted docs](https://szymon20000.github.io/react-native-runtimes/)
- 📦 [Core package — full API reference](packages/core/README.md)
- 🗂 [State package — shared store API](packages/state/README.md)
- 🏗 [Docusaurus source](website/docs/intro.md)

---



## Authors

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/Szymon20000">
        <img src="https://github.com/Szymon20000.png" width="64" /><br/>
        <sub><b>Szymon Kapała</b></sub>
      </a><br/>
      <a href="https://x.com/Turbo_Szymon">@Turbo_Szymon</a>
    </td>
    <td align="center">
      <a href="https://github.com/v3ron">
        <img src="https://github.com/v3ron.png" width="64" /><br/>
        <sub><b>Szymon Chmal</b></sub>
      </a><br/>
      <a href="https://x.com/ChmalSzymon">@ChmalSzymon</a>
    </td>
    <td align="center">
      <a href="https://github.com/pioner92">
        <img src="https://github.com/pioner92.png" width="64" /><br/>
        <sub><b>Alex Shumihin</b></sub>
      </a><br/>
      <a href="https://x.com/pioner_dev">@pioner_dev</a>
    </td>
    <td align="center">
      <a href="https://github.com/riteshshukla04">
        <img src="https://github.com/riteshshukla04.png" width="64" /><br/>
        <sub><b>Ritesh Shukla</b></sub>
      </a><br/>
      <a href="https://x.com/RiteshRk14">@RiteshRk14</a>
    </td>
  </tr>
</table>

---

<div align="center">

MIT License · Built with ❤️ for the React Native community

</div>
