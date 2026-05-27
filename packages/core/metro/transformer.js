const upstreamTransformer = require('@react-native/metro-babel-transformer');
const runtimeFunctionPlugin = require('../runtime-function-babel-plugin');

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
