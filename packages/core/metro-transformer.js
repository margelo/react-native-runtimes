const runtimeFunctionPlugin = require('./runtime-function-babel-plugin');

// Wrap the project's actual upstream babel transformer. In an Expo app the
// default transformer is Expo's (babel-preset-expo, server transforms, etc.) and
// replacing it with the bare RN transformer breaks Expo's dev-server pipeline.
// So prefer Expo's transformer when the project uses Expo, otherwise fall back to
// the bare React Native transformer. One file works for both bare RN and Expo.
function resolveUpstreamTransformer() {
  try {
    const expoMetroConfig = require.resolve('expo/metro-config');
    return require(
      require.resolve('@expo/metro-config/build/babel-transformer', {
        paths: [expoMetroConfig],
      }),
    );
  } catch (_) {
    return require('@react-native/metro-babel-transformer');
  }
}

const upstreamTransformer = resolveUpstreamTransformer();

function transform(params) {
  const plugins = [
    ...(params.plugins || []),
    [runtimeFunctionPlugin, { projectRoot: params.options?.projectRoot }],
  ];

  return upstreamTransformer.transform({
    ...params,
    plugins,
  });
}

module.exports = {
  ...upstreamTransformer,
  transform,
};
