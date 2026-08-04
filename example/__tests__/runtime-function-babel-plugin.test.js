const { transformSync } = require('@babel/core');
const plugin = require('../../packages/core/runtime-function-babel-plugin.js');

// Two directive functions in ONE file: regression coverage for the shared
// AST-node bug. The plugin used to reuse the same imported-identifier node
// object across replacements, so babel's module transform only rewrote the
// first occurrence — the second function then compiled to a call on the raw
// module namespace and threw "undefined is not a function" at module eval.
const SOURCE = `
export async function first(a) {
  'my-worker';
  return a + 1;
}

export async function second(b) {
  'my-worker';
  return b + 2;
}
`;

function transform(extraPlugins = []) {
  return transformSync(SOURCE, {
    filename: '/project/src/workers.js',
    configFile: false,
    babelrc: false,
    plugins: [[plugin, { projectRoot: '/project' }], ...extraPlugins],
  }).code;
}

describe('runtime-function babel plugin with multiple directive functions', () => {
  it('assigns each function its own runtime-function id', () => {
    const code = transform();
    expect(code).toContain('"src/workers.first_"');
    expect(code).toContain('"src/workers.second_"');
  });

  it('compiled CommonJS module evaluates and registers BOTH functions', () => {
    const code = transform([
      require.resolve('@babel/plugin-transform-modules-commonjs'),
    ]);

    const withIdIds = [];
    const callWrapped = [];
    const coreMock = {
      runtimeFunction: {
        withId: (id, fn) => {
          withIdIds.push(id);
          return fn;
        },
      },
      call: fn => {
        callWrapped.push(fn);
        return {
          on:
            runtimeName =>
            (...args) => ({ runtimeName, args }),
        };
      },
    };
    const requireMock = id => {
      if (id === '@react-native-runtimes/core') {
        return coreMock;
      }
      throw new Error(`unexpected require: ${id}`);
    };
    const moduleObj = { exports: {} };

    // Before the cloneNode fix this evaluation threw
    // "undefined is not a function" while evaluating the SECOND function's
    // declarations.
    expect(() => {
      new Function('require', 'module', 'exports', code)(
        requireMock,
        moduleObj,
        moduleObj.exports,
      );
    }).not.toThrow();

    expect(withIdIds).toEqual(['src/workers.first_', 'src/workers.second_']);
    expect(callWrapped).toHaveLength(2);
    expect(typeof moduleObj.exports.first_).toBe('function');
    expect(typeof moduleObj.exports.second_).toBe('function');

    // The dispatch aliases must be bound to the configured runtime.
    expect(moduleObj.exports.first(1).runtimeName).toBe('my-worker');
    expect(moduleObj.exports.second(2).runtimeName).toBe('my-worker');
  });
});
