# Contributing to react-native-runtimes

Thank you for your interest in contributing! This guide covers the project architecture and how to run the example app locally.

---

## Architecture

```mermaid
flowchart LR
  Main["Main Hermes runtime<br/>navigation, input, app shell"]
  Host["Native runtime host<br/>Fabric surface + Nitro"]
  Chat["Hermes runtime: chat<br/>threaded screen or component"]
  Worker["Hermes runtime: worker<br/>headless tasks and functions"]
  State["C++ shared state<br/>sync reads + native persistence"]

  Main -->|"OnRuntime / ThreadedScreen"| Host
  Main -->|"runtimeFunction / headless task"| Host
  Host --> Chat
  Host --> Worker
  Main <--> State
  Chat <--> State
  Worker <--> State
```

Secondary runtimes can host React Native surfaces, execute typed functions, run headless jobs, and coordinate through native shared state while staying isolated from the main JS heap.

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
