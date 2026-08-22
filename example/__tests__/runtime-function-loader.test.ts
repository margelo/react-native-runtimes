jest.mock('react-native/Libraries/Core/registerCallableModule', () => {
  const callableModules = new Map<string, object | (() => object)>();
  return {
    __esModule: true,
    callableModules,
    default: (name: string, moduleOrFactory: object | (() => object)) => {
      callableModules.set(name, moduleOrFactory);
    },
  };
});

jest.mock('react-native', () => {
  const completeRuntimeFunctionCall = jest.fn(() => Promise.resolve());
  return {
    NativeModules: {
      ThreadedRuntime: { completeRuntimeFunctionCall },
    },
    Platform: { OS: 'android' },
    requireNativeComponent: () => 'ThreadedRuntimeSurface',
    __mockCompleteRuntimeFunctionCall: completeRuntimeFunctionCall,
  };
});

import {
  registerRuntimeFunction,
  runtimeFunction,
} from '@react-native-runtimes/core';

const { callableModules: mockCallableModules } = jest.requireMock(
  'react-native/Libraries/Core/registerCallableModule',
) as {
  callableModules: Map<string, object | (() => object)>;
};
const { __mockCompleteRuntimeFunctionCall: mockCompleteRuntimeFunctionCall } =
  jest.requireMock('react-native') as {
    __mockCompleteRuntimeFunctionCall: jest.Mock<
      Promise<void>,
      [string, string | null, string | null]
    >;
  };

type RuntimeFunctionLoader = () => (...args: unknown[]) => unknown;
type RuntimeFunctionRunner = {
  run(
    functionId: string,
    argsJson: string,
    callId: string,
    runtimeName: string,
  ): Promise<void>;
};

type RuntimeFunctionGlobals = typeof globalThis & {
  __THREADED_RUNTIME_ENV__?: { runtimeName?: string; kind?: string };
  __rnrRegisterRuntimeFunction?: (
    functionId: string,
    loader: RuntimeFunctionLoader,
  ) => void;
  __rnrCallRuntimeFunction?: (functionId: string, argsJson: string) => unknown;
};

const globals = globalThis as RuntimeFunctionGlobals;
const jsiLoaders = new Map<string, RuntimeFunctionLoader>();
const originalRuntimeEnvironment = globals.__THREADED_RUNTIME_ENV__;
const originalRegisterRuntimeFunction = globals.__rnrRegisterRuntimeFunction;
const originalCallRuntimeFunction = globals.__rnrCallRuntimeFunction;

function getRuntimeFunctionRunner(): RuntimeFunctionRunner {
  const moduleOrFactory = mockCallableModules.get(
    'ThreadedRuntimeFunctionRunner',
  );
  if (!moduleOrFactory) {
    throw new Error('ThreadedRuntimeFunctionRunner was not registered');
  }
  return (
    typeof moduleOrFactory === 'function' ? moduleOrFactory() : moduleOrFactory
  ) as RuntimeFunctionRunner;
}

function getCompletionError(callId: string) {
  const completion = mockCompleteRuntimeFunctionCall.mock.calls.find(
    ([completedCallId]) => completedCallId === callId,
  );
  if (!completion) {
    throw new Error(`No completion recorded for call "${callId}"`);
  }
  const errorJson = completion[2];
  return errorJson ? JSON.parse(errorJson) : null;
}

describe('registered runtime-function loader failures', () => {
  beforeEach(() => {
    mockCompleteRuntimeFunctionCall.mockClear();
    jsiLoaders.clear();
    globals.__THREADED_RUNTIME_ENV__ = {
      runtimeName: 'loader-test-runtime',
      kind: 'business-runtime',
    };
    globals.__rnrRegisterRuntimeFunction = (functionId, loader) => {
      jsiLoaders.set(functionId, loader);
    };
    globals.__rnrCallRuntimeFunction = (functionId, argsJson) => {
      const loader = jsiLoaders.get(functionId);
      if (!loader) {
        return undefined;
      }
      const args = JSON.parse(argsJson) as unknown[];
      return loader()(...args);
    };
  });

  afterAll(() => {
    if (originalRuntimeEnvironment === undefined) {
      delete globals.__THREADED_RUNTIME_ENV__;
    } else {
      globals.__THREADED_RUNTIME_ENV__ = originalRuntimeEnvironment;
    }
    if (originalRegisterRuntimeFunction === undefined) {
      delete globals.__rnrRegisterRuntimeFunction;
    } else {
      globals.__rnrRegisterRuntimeFunction = originalRegisterRuntimeFunction;
    }
    if (originalCallRuntimeFunction === undefined) {
      delete globals.__rnrCallRuntimeFunction;
    } else {
      globals.__rnrCallRuntimeFunction = originalCallRuntimeFunction;
    }
  });

  it('serializes thrown loader errors with function and runtime context', async () => {
    const functionId = 'test/loader.throws';
    const originalCause = new Error('native package bootstrap exploded');
    registerRuntimeFunction(functionId, () => {
      throw originalCause;
    });

    let localError: unknown;
    try {
      jsiLoaders.get(functionId)?.();
    } catch (caughtError) {
      localError = caughtError;
    }
    expect(localError).toMatchObject({
      name: 'RuntimeFunctionLoadError',
      cause: originalCause,
    });

    await getRuntimeFunctionRunner().run(
      functionId,
      '[]',
      'throwing-loader-call',
      'loader-test-runtime',
    );

    const error = getCompletionError('throwing-loader-call');
    expect(error.name).toBe('RuntimeFunctionLoadError');
    expect(error.runtimeName).toBe('loader-test-runtime');
    expect(error.message).toContain(functionId);
    expect(error.message).toContain('loader-test-runtime');
    expect(error.message).toContain('native package bootstrap exploded');
  });

  it.each([
    ['undefined', undefined],
    ['object', { default: undefined }],
  ])(
    'explains when a loader resolves to %s instead of a function',
    async (resolvedType, resolvedValue) => {
      const functionId = `test/loader.resolves-${resolvedType}`;
      registerRuntimeFunction(functionId, () => resolvedValue as never);

      await getRuntimeFunctionRunner().run(
        functionId,
        '[]',
        `${resolvedType}-loader-call`,
        'loader-test-runtime',
      );

      const error = getCompletionError(`${resolvedType}-loader-call`);
      expect(error.name).toBe('RuntimeFunctionLoadError');
      expect(error.runtimeName).toBe('loader-test-runtime');
      expect(error.message).toContain(functionId);
      expect(error.message).toContain('loader-test-runtime');
      expect(error.message).toContain(`resolved to ${resolvedType}`);
      expect(error.message).toMatch(/module likely failed to initialize/i);
      expect(error.message).toMatch(/native packages may be missing/i);
    },
  );

  it('reloads after an invalid result instead of caching it', async () => {
    const functionId = 'test/loader.invalid-cache-entry';
    let loadCount = 0;
    globals.__rnrCallRuntimeFunction = () => undefined;
    registerRuntimeFunction(functionId, () => {
      loadCount += 1;
      return loadCount === 1
        ? ({ invalid: true } as never)
        : runtimeFunction(() => 'recovered');
    });

    await getRuntimeFunctionRunner().run(
      functionId,
      '[]',
      'invalid-cache-call',
      'actual-runner-runtime',
    );
    await getRuntimeFunctionRunner().run(
      functionId,
      '[]',
      'recovered-cache-call',
      'actual-runner-runtime',
    );

    expect(getCompletionError('invalid-cache-call')).toMatchObject({
      name: 'RuntimeFunctionLoadError',
      runtimeName: 'actual-runner-runtime',
    });
    const recoveredCompletion = mockCompleteRuntimeFunctionCall.mock.calls.find(
      ([callId]) => callId === 'recovered-cache-call',
    );
    expect(recoveredCompletion?.[1]).toBe(JSON.stringify('recovered'));
    expect(recoveredCompletion?.[2]).toBeNull();
    expect(loadCount).toBe(2);
  });
});
