module.exports = {
  preset: '@react-native/jest-preset',
  // *.harness.* files run on-device via react-native-harness
  // (jest.harness.config.mjs), not under plain jest.
  testPathIgnorePatterns: ['/node_modules/', '\\.harness\\.[jt]sx?$'],
  // Resolve the workspace packages from source (their lib/ build output may
  // not exist locally).
  moduleNameMapper: {
    '^@react-native-runtimes/(core|state)$': '<rootDir>/../packages/$1/src',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-ease|@shopify/flash-list|@legendapp)/)',
  ],
};
