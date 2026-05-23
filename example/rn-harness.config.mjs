import {
  androidPlatform,
  androidEmulator,
} from '@react-native-harness/platform-android';
import {
  applePlatform,
  appleSimulator,
} from '@react-native-harness/platform-apple';

const config = {
  entryPoint: './index.js',
  appRegistryComponentName: 'NativeComposeChat',

  runners: [
    androidPlatform({
      name: 'android',
      device: androidEmulator('Pixel_8'),
      bundleId: 'com.nativecomposechat',
    }),
    applePlatform({
      name: 'ios',
      device: appleSimulator('iPhone 17 Pro', '26.2'),
      bundleId: 'org.reactjs.native.example.NativeComposeChat',
    }),
  ],
  defaultRunner: 'android',
  bridgeTimeout: 180000,
};

export default config;
