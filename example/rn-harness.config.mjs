import {
  androidPlatform,
  androidEmulator,
} from '@react-native-harness/platform-android';
import {
  applePlatform,
  appleSimulator,
} from '@react-native-harness/platform-apple';

const isCI = process.env.CI === 'true';

const config = {
  entryPoint: './index.js',
  appRegistryComponentName: 'NativeComposeChat',

  runners: [
    androidPlatform({
      name: 'android',
      // Always reuse an already-running emulator (never create/boot/snapshot
      // one from the harness). On CI, android-emulator-runner boots the
      // emulator named AVD_NAME; locally, use your running AVD. This keeps the
      // harness from owning the emulator lifecycle — it never issues the
      // blocking `adb emu kill` teardown that hangs snapshot-enabled emulators.
      device: androidEmulator(process.env.AVD_NAME ?? 'Pixel_8_API_35'),
      bundleId: 'com.nativecomposechat',
    }),
    applePlatform({
      name: 'ios',
      device: appleSimulator(
        process.env.DEVICE_MODEL ?? 'iPhone 17 Pro',
        process.env.IOS_VERSION ?? '26.2',
      ),
      bundleId: 'org.reactjs.native.example.NativeComposeChat',
    }),
  ],
  defaultRunner: 'android',
  bridgeTimeout: 180000,
  // CI runners are slower than local machines - give builds/bundling more headroom.
  ...(isCI && {
    platformReadyTimeout: 420000,
    bundleStartTimeout: 120000,
  }),
};

export default config;
