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
      device: androidEmulator(
        process.env.AVD_NAME ?? 'Pixel_8',
        // On CI the AVD does not exist yet, so pass the full AVD spec and let
        // the harness create it. Locally, reuse the existing AVD as-is.
        isCI
          ? {
              apiLevel: Number(process.env.DEVICE_API_LEVEL ?? 36),
              profile: process.env.DEVICE_PROFILE ?? 'pixel_7',
              diskSize: process.env.AVD_DISK_SIZE ?? '1G',
              heapSize: process.env.AVD_HEAP_SIZE ?? '1G',
              snapshot: {
                enabled: true,
              },
            }
          : undefined,
      ),
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
