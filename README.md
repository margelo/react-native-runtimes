# react-native-runtimes

React Native 0.86 new-architecture playground for multi-runtime rendering,
shared state, and list baselines.

The app exercises:

- Main-runtime RN list baselines with FlatList and LegendList.
- Threaded-runtime list surfaces with FlashList and LegendList.
- Whole-screen threaded rendering for chat-style flows.
- Shared state across runtimes through `@react-native-runtimes/state`.
- Runtime prewarming, headless tasks, and a two-runtime architecture example.

## Running

Install dependencies, then run the normal React Native commands:

```sh
npm install
npm run android
npm run ios
```

Release builds used for smoke testing:

```sh
cd android
./gradlew :app:assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

## Documentation

Start with the hosted docs:

- [Native Compose Runtimes docs](https://szymon20000.github.io/react-native-runtimes/)

Source docs are also available in the repo:

- [Threaded runtime package docs](packages/core/README.md)
- [Threaded Zustand package docs](packages/state/README.md)
- [Docusaurus source docs](website/docs/intro.md)

## Authors

- **Szymon Kapała** — [GitHub](https://github.com/Szymon20000) · [X](https://x.com/Turbo_Szymon)
- **Szymon Chmal** — [GitHub](https://github.com/v3ron) · [X](https://x.com/ChmalSzymon)
- **Alex Shumihin** — [GitHub](https://github.com/pioner92) · [X](https://x.com/pioner_dev)
- **Ritesh Shukla** — [GitHub](https://github.com/riteshshukla04) · [X](https://x.com/RiteshRk14)
