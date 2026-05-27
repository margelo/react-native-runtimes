# Rendering Components on a Secondary Runtime

Mount a React component on a named runtime via a native `ThreadedRuntimeSurface`. The surface asks the named runtime to render `ThreadedRuntimeHost`, and the host resolves the registered component by name.

## Three entry points

### `OnRuntime` — declarative, Metro-rewritten

The most common form. Wrap a top-level component reference; Metro rewrites the child into a `threadedComponent` registration with a stable file-based id.

```tsx
import { OnRuntime } from '@react-native-runtimes/core';

function MessageList({ conversationId }: { conversationId: string }) {
  return <ActualMessageList conversationId={conversationId} />;
}

<OnRuntime name="messages-runtime">
  <MessageList conversationId="release-room" />
</OnRuntime>
```

`OnRuntime` props:
- `name: string` — runtime name (required)
- other props pass through to the underlying surface (`style`, `testID`, `surfaceKey`, etc.)

### `<Threaded>` — explicit mount

When you have a `threadedComponent`-registered component and want to pass surface props directly:

```tsx
import { Threaded, threadedComponent } from '@react-native-runtimes/core';

export const MessageList = threadedComponent<MessageListProps>(
  'MessageList',
  function MessageList(props) { return <ActualMessageList {...props} />; },
);

<Threaded
  component={MessageList}
  props={{ conversationId, initialIndex }}
  runtimeName="messages-runtime"
  surfaceKey="messages-release-room"
/>
```

### `<ThreadedScreen>` — full-flex route

For whole routes. Applies `{ flex: 1 }`, preloads the runtime by default (from a React effect), keeps it alive on unmount unless `destroyOnUnmount`.

```tsx
<ThreadedScreen
  component={ConversationScreen}
  props={{ conversationId }}
  runtimeName={`conversation-${conversationId}-runtime`}
  destroyOnUnmount      // optional — destroy the runtime when the screen unmounts
  testID="conversation-threaded-screen"
/>
```

Use `destroyOnUnmount` only for genuinely single-use routes. For chat threads / tabs the user re-enters, leave the runtime alive — every re-entry pays the bundle-load cost otherwise.

### `<ThreadedReactSurface>` — lower level

Takes a component **name** (string) rather than a registered reference. Useful when the name is computed at runtime.

```tsx
<ThreadedReactSurface
  componentName="ExpensivePanel"
  initialProps={{ mode: 'compare' }}
  runtimeName="analytics-runtime"
  style={{ flex: 1 }}
  surfaceKey="analytics-panel"
/>
```

Changing `componentName`, `initialProps`, `runtimeName`, or `surfaceKey` restarts the native surface.

## Registration APIs

`threadedComponent<Props>(name, Component)` — registers a component under a stable name (the lookup key for the threaded surface).

```tsx
export const ConversationScreen = threadedComponent<ConversationScreenProps>(
  'ConversationScreen',
  function ConversationScreen(props) { return <ConversationRoute {...props} />; },
);
```

`registerThreadedComponent(name, Component)` — register at module load time without wrapping the component.

`registerLazyThreadedComponent(name, () => Component)` — same but lazy. The Metro-generated entry uses this form so threaded runtimes don't eagerly evaluate every threaded component on startup.

## Rules (will catch you if violated)

- **`OnRuntime`'s child must be a direct, top-level component reference.** Ternaries, prop-forwarded `children`, and wrappers (`<Suspense>`, etc.) break Metro's static analysis:
  ```tsx
  // Doesn't work:
  <OnRuntime name="x">{condition ? <A /> : <B />}</OnRuntime>
  <OnRuntime name="x">{children}</OnRuntime>
  // Works: move the condition outside, or use threadedComponent + <Threaded> explicitly.
  ```
- **The child component must be defined at module top level** — not inside another function. Metro attaches the registration to the export.
- **Threaded component names must be globally unique.** Duplicate names fail the Metro build. The directive form uses a stable file-based id; explicit `threadedComponent('Name', ...)` is what you control.
- **`threadedComponent(...)` must be assigned to a named export.** The Metro wrapper only scans `ExportNamedDeclaration` nodes, so an unexported `const` or a default export is silently skipped — no build error, but the threaded surface fails at runtime with "component not found." Always use `export const Name = threadedComponent('Name', fn);` — not `const Name = ...` (no export) and not `export default threadedComponent(...)`.
- **Props must be JSON-serializable.** No functions, refs, class instances, `Map`/`Set`, `BigInt`, circular refs. `Date` becomes `{}` unless you `.toISOString()` first.
- **`OnRuntime` accepts one threaded child.** For multiple components on the same runtime, render them inside one wrapper component.
- **Component file must be under one of Metro's `roots`.** If it isn't scanned, the registration doesn't exist on the threaded side.

## Passing data

Props go through JSON. Pass identity, not the data itself.

```tsx
<ThreadedScreen
  component={ConversationScreen}
  props={{ conversationId }}
  runtimeName={`conversation-${conversationId}-runtime`}
/>
```

```tsx
function ConversationRoute({ conversationId }: { conversationId: string }) {
  const messages = chatStore.path<Message[]>(['conversations', conversationId]).use(v => v ?? []);
  return <MessageList messages={messages} />;
}
```

The threaded screen subscribes to a shared path; no large payload crosses the runtime boundary on each update. See [shared-state.md](shared-state.md).

## When to reach for which entry point

| Need | Use |
| --- | --- |
| Single component or sub-tree on another runtime | `OnRuntime` |
| Whole route / screen | `ThreadedScreen` |
| Surface props you need direct control over (`surfaceKey`, lifecycle) | `<Threaded>` |
| Component name is computed at runtime / dynamic catalog | `<ThreadedReactSurface>` |

## What it does at runtime

1. The native surface (`ThreadedRuntimeSurface`) creates or reuses the named secondary runtime.
2. That runtime loads the bundle (cached on warm starts) and registers `ThreadedRuntimeHost` as its app root.
3. The surface asks the runtime to render `ThreadedRuntimeHost` with `{ componentName, initialPropsJson }`.
4. The host resolves the registered component (`threadedComponent` / `OnRuntime`'s generated registration) by name and renders it with the parsed props.

Changing the runtime name creates a *new* runtime. The old one stays alive until you `ThreadedRuntime.destroy(name)` it.

## Related

- Set up the Metro wrapper / native modules that make registrations work → [quickstart.md](quickstart.md)
- Prewarm a runtime before mounting the surface; destroy when done → [headless-and-lifecycle.md](headless-and-lifecycle.md)
- Subscribe to data inside the threaded component instead of passing it as a prop → [shared-state.md](shared-state.md)
- Return a value from work running on the threaded runtime → [runtime-functions.md](runtime-functions.md)
- Symptoms: blank threaded surface, duplicate-name build errors, `<OnRuntime>` not registering → [gotchas.md](gotchas.md)
