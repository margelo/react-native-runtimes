---
id: intro
title: Overview
slug: /
---

Native Compose Runtimes provides two React Native libraries:

- `@react-native-runtimes/core` mounts selected React components, whole screens, and scheduled runtime functions on named secondary React Native runtimes.
- `@react-native-runtimes/state` provides a small Zustand-like shared store backed by native C++ state so multiple runtimes can read and update the same data.

The main use cases are chat screens, expensive list renderers, background preparation, and shared state that must survive across runtime boundaries.

Use threaded rendering when the main JS runtime should stay responsive while another runtime owns part of the UI. Use the shared store when data is too large, mutable, or frequently changing to pass as props.

## Concepts

- A runtime is identified by a string such as `conversation-42-runtime`.
- A threaded component is a React component registered with `threadedComponent`.
- A threaded surface is a native view that asks the named runtime to render a registered component.
- A prewarmed runtime is started before it is visible.
- A scheduled runtime function runs JS on a named runtime without mounting UI or returning a value to the caller.
- Shared Zustand stores synchronize state between the main runtime and secondary runtimes.
