import React, {
  type ComponentType,
  type ReactElement,
  useEffect,
  useMemo,
} from 'react';
import {
  NativeModules,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import NativeThreadedRuntimeSurface from './NativeThreadedRuntimeSurface';

const DEFAULT_RUNTIME_NAME = 'background-list';
const DEFAULT_BUSINESS_RUNTIME_NAME = 'business-runtime';
const DEFAULT_HOST_APP_NAME = 'ThreadedRuntimeHost';
const DEFAULT_RUNTIME_KIND = 'threaded-runtime';
const BUSINESS_RUNTIME_KIND = 'business-runtime';
const THREADED_SCREEN_STYLE: ViewStyle = { flex: 1 };
const RUNTIME_FUNCTION_RUNNER_MODULE = 'ThreadedRuntimeFunctionRunner';

export type ThreadedComponent<Props extends object = Record<string, never>> =
  ComponentType<Props> & {
    __threadedRuntime: {
      name: string;
    };
  };

type ThreadedComponentLoader = () => ComponentType<any>;
type ThreadedComponentRegistry = Map<string, ThreadedComponentLoader>;
type RuntimeFunctionLoader = () => RuntimeFunction<any>;

const threadedComponents: ThreadedComponentRegistry = new Map();
const runtimeFunctions = new Map<string, RuntimeFunctionLoader>();
const loadedRuntimeFunctions = new Map<string, RuntimeFunction<any>>();

type RuntimeFunctionJsiGlobal = typeof globalThis & {
  __rnrRegisterRuntimeFunction?: (
    id: string,
    loadFunction: RuntimeFunctionLoader,
  ) => void;
  __rnrCallRuntimeFunction?: (functionId: string, argsJson: string) => unknown;
};

type ThreadedRuntimeFunctionsNitro = {
  install: (runtimeName?: string) => void;
  run?: (
    runtimeName: string,
    functionId: string,
    argsJson: string,
  ) => Promise<string>;
  call?: (
    runtimeName: string,
    functionId: string,
    argsJson: string,
  ) => Promise<string>;
  schedule?: (
    runtimeName: string,
    functionId: string,
    argsJson: string,
  ) => Promise<void>;
};

type ThreadedRuntimeNativeModule = {
  preloadRuntime?: (runtimeName: string) => Promise<void>;
  prewarmRuntime?: (runtimeName: string) => Promise<void>;
  prewarmRuntimeWithOptions?: (
    runtimeName: string,
    kind: string,
    useMainNativeModules: boolean,
  ) => Promise<void>;
  call?: (
    runtimeName: string,
    functionId: string,
    argsJson: string,
  ) => Promise<string>;
  schedule?: (
    runtimeName: string,
    functionId: string,
    argsJson: string,
  ) => Promise<void>;
  completeRuntimeFunctionCall?: (
    callId: string,
    resultJson: string | null,
    errorJson: string | null,
  ) => Promise<void>;
  destroyRuntime?: (runtimeName: string) => Promise<void>;
  destroyAllRuntimes?: () => Promise<void>;
  getRuntimeNames?: () => Promise<string[]>;
};

const nativeRuntime = NativeModules.ThreadedRuntime as
  | ThreadedRuntimeNativeModule
  | undefined;

let runtimeFunctionsNitro: ThreadedRuntimeFunctionsNitro | null | undefined;
let didWarnRuntimeFunctionsNitroUnavailable = false;

function currentRuntimeName() {
  const globals = globalThis as {
    __THREADED_RUNTIME_ENV__?: { runtimeName?: string };
    __COMPOSE_CHAT_LIST_ENV__?: { runtimeName?: string };
  };
  return (
    globals.__THREADED_RUNTIME_ENV__?.runtimeName ??
    globals.__COMPOSE_CHAT_LIST_ENV__?.runtimeName ??
    DEFAULT_RUNTIME_NAME
  );
}

export const MAIN_RUNTIME_NAME = 'main';

export type CurrentRuntimeInfo = {
  isMain: boolean;
  name: string;
  kind: string | null;
};

export function getCurrentRuntime(): CurrentRuntimeInfo {
  const globals = globalThis as {
    __THREADED_RUNTIME_ENV__?: { runtimeName?: string; kind?: string };
    __COMPOSE_CHAT_LIST_ENV__?: { runtimeName?: string; kind?: string };
  };
  const env =
    globals.__THREADED_RUNTIME_ENV__ ?? globals.__COMPOSE_CHAT_LIST_ENV__;
  if (env?.runtimeName) {
    return {
      isMain: false,
      name: env.runtimeName,
      kind: env.kind ?? null,
    };
  }
  return { isMain: true, name: MAIN_RUNTIME_NAME, kind: null };
}

export function getCurrentRuntimeName(): string {
  return getCurrentRuntime().name;
}

export function isMainRuntime(): boolean {
  return getCurrentRuntime().isMain;
}

function getRuntimeFunctionsNitro() {
  if (runtimeFunctionsNitro !== undefined) {
    return runtimeFunctionsNitro;
  }

  try {
    const { NitroModules } = require('react-native-nitro-modules') as {
      NitroModules: {
        hasHybridObject: (name: string) => boolean;
        createHybridObject: <T>(name: string) => T;
      };
    };
    runtimeFunctionsNitro = NitroModules.hasHybridObject(
      'ThreadedRuntimeFunctions',
    )
      ? NitroModules.createHybridObject<ThreadedRuntimeFunctionsNitro>(
          'ThreadedRuntimeFunctions',
        )
      : null;
  } catch (error) {
    runtimeFunctionsNitro = null;
    if (!didWarnRuntimeFunctionsNitroUnavailable) {
      didWarnRuntimeFunctionsNitroUnavailable = true;
      console.warn(
        '[threaded-runtime] Nitro runtime functions unavailable',
        error,
      );
    }
  }

  return runtimeFunctionsNitro;
}

function installRuntimeFunctionJsi() {
  const globals = globalThis as RuntimeFunctionJsiGlobal;
  if (
    globals.__rnrRegisterRuntimeFunction &&
    globals.__rnrCallRuntimeFunction
  ) {
    return;
  }

  getRuntimeFunctionsNitro()?.install(currentRuntimeName());
}

function isRuntimeDispatcherMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('No runtime dispatcher registered') ||
    message.includes('Runtime dispatcher expired')
  );
}

export type ThreadedRuntimeName = string;
export type ThreadedRuntimePrewarmOptions = {
  kind?: string;
  useMainNativeModules?: boolean;
};

type AnyFunction = (...args: any[]) => any;
type VoidReturningFunction<TFunction extends AnyFunction> = Awaited<
  ReturnType<TFunction>
> extends void
  ? TFunction
  : never;

export type RuntimeFunctionMetadata = {
  id: string;
};

export type RuntimeFunction<TFunction extends AnyFunction> = TFunction & {
  __runtimeFunction?: RuntimeFunctionMetadata;
  runOn(
    runtimeName: ThreadedRuntimeName,
    ...args: Parameters<TFunction>
  ): Promise<Awaited<ReturnType<TFunction>>>;
} & (Awaited<ReturnType<TFunction>> extends void
    ? {
        scheduleOn(
          runtimeName: ThreadedRuntimeName,
          ...args: Parameters<TFunction>
        ): Promise<void>;
      }
    : {});

export type RuntimeFunctionCallBuilder<TFunction extends AnyFunction> = {
  on(
    runtimeName: ThreadedRuntimeName,
  ): (
    ...args: Parameters<TFunction>
  ) => Promise<Awaited<ReturnType<TFunction>>>;
};

export type RuntimeFunctionScheduleBuilder<TFunction extends AnyFunction> = {
  on(
    runtimeName: ThreadedRuntimeName,
  ): (...args: Parameters<TFunction>) => Promise<void>;
};

export type RuntimeFunctionFactory = {
  <TFunction extends AnyFunction>(fn: TFunction): RuntimeFunction<TFunction>;
  withId<TFunction extends AnyFunction>(
    id: string,
    fn: TFunction,
  ): RuntimeFunction<TFunction>;
  named<TFunction extends AnyFunction>(
    id: string,
    fn: TFunction,
  ): RuntimeFunction<TFunction>;
};

export type ThreadedProps<Props extends object = Record<string, never>> = {
  accessibilityLabel?: string;
  component: ThreadedComponent<Props>;
  props?: Props;
  runtimeName?: ThreadedRuntimeName;
  style?: StyleProp<ViewStyle>;
  surfaceKey?: string;
  testID?: string;
};

export type ThreadedScreenProps<Props extends object = Record<string, never>> =
  ThreadedProps<Props> & {
    destroyOnUnmount?: boolean;
    preload?: boolean;
  };

export type OnRuntimeProps<Props extends object = Record<string, never>> = {
  accessibilityLabel?: string;
  children: ReactElement<Props>;
  name: ThreadedRuntimeName;
  style?: StyleProp<ViewStyle>;
  surfaceKey?: string;
  testID?: string;
};

export type ThreadedReactSurfaceProps<
  Props extends object = Record<string, never>,
> = {
  componentName: string;
  initialProps?: Props;
  runtimeName?: ThreadedRuntimeName;
  surfaceKey?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
};

export function registerThreadedComponent<Props extends object>(
  name: string,
  component: ComponentType<Props>,
) {
  threadedComponents.set(name, () => component as ComponentType<any>);
}

export function registerLazyThreadedComponent<Props extends object>(
  name: string,
  loadComponent: () => ComponentType<Props>,
) {
  threadedComponents.set(name, loadComponent as ThreadedComponentLoader);
}

export function registerRuntimeFunction<TFunction extends AnyFunction>(
  id: string,
  loadFunction: () => RuntimeFunction<TFunction>,
) {
  installRuntimeFunctionJsi();
  runtimeFunctions.set(id, loadFunction as RuntimeFunctionLoader);
  (globalThis as RuntimeFunctionJsiGlobal).__rnrRegisterRuntimeFunction?.(
    id,
    loadFunction as RuntimeFunctionLoader,
  );
}

function attachRuntimeFunction<TFunction extends AnyFunction>(
  id: string | null,
  fn: TFunction,
): RuntimeFunction<TFunction> {
  const runtimeFn = fn as RuntimeFunction<TFunction>;
  if (id) {
    runtimeFn.__runtimeFunction = { id };
  }
  runtimeFn.runOn = (runtimeName, ...args) =>
    ThreadedRuntime.call(runtimeName, runtimeFn, ...args);
  Object.assign(runtimeFn, {
    scheduleOn: (runtimeName: ThreadedRuntimeName, ...args: unknown[]) =>
      ThreadedRuntime.schedule(
        runtimeName,
        runtimeFn as RuntimeFunction<(...args: any[]) => void>,
        ...args,
      ),
  });
  return runtimeFn;
}

const createRuntimeFunction = <TFunction extends AnyFunction>(
  fn: TFunction,
): RuntimeFunction<TFunction> => attachRuntimeFunction(null, fn);

createRuntimeFunction.withId = function runtimeFunctionWithId<
  TFunction extends AnyFunction,
>(id: string, fn: TFunction): RuntimeFunction<TFunction> {
  return attachRuntimeFunction(id, fn);
};

createRuntimeFunction.named = createRuntimeFunction.withId;

export const runtimeFunction = createRuntimeFunction as RuntimeFunctionFactory;

export function call<TFunction extends AnyFunction>(
  fn: RuntimeFunction<TFunction>,
): RuntimeFunctionCallBuilder<TFunction> {
  return {
    on(runtimeName) {
      return (...args) => ThreadedRuntime.call(runtimeName, fn, ...args);
    },
  };
}

export function schedule<TFunction extends AnyFunction>(
  fn: RuntimeFunction<TFunction> &
    RuntimeFunction<VoidReturningFunction<TFunction>>,
): RuntimeFunctionScheduleBuilder<TFunction> {
  return {
    on(runtimeName) {
      return (...args) => ThreadedRuntime.schedule(runtimeName, fn, ...args);
    },
  };
}

export function usingRuntime(runtimeName: ThreadedRuntimeName) {
  return {
    run<TValue>(_callback: () => TValue): Promise<Awaited<TValue>> {
      return Promise.reject(
        new Error(
          `usingRuntime("${runtimeName}").run(...) must be compiled by the ` +
            '@react-native-runtimes/core Metro transformer',
        ),
      );
    },
  };
}

export function threadedComponent<Props extends object>(
  name: string,
  component: ComponentType<Props>,
): ThreadedComponent<Props> {
  return Object.assign(component, {
    __threadedRuntime: {
      name,
    },
  });
}

export function Threaded<Props extends object>({
  accessibilityLabel,
  component,
  props,
  runtimeName,
  style,
  surfaceKey,
  testID,
}: ThreadedProps<Props>) {
  return (
    <ThreadedReactSurface
      accessibilityLabel={accessibilityLabel}
      componentName={component.__threadedRuntime.name}
      initialProps={props}
      runtimeName={runtimeName}
      style={style}
      surfaceKey={surfaceKey}
      testID={testID}
    />
  );
}

export function OnRuntime<Props extends object>({
  accessibilityLabel,
  children,
  name,
  style,
  surfaceKey,
  testID,
}: OnRuntimeProps<Props>) {
  const child = React.Children.only(children) as ReactElement<Props>;
  const component = child.type as ThreadedComponent<Props>;

  if (!component.__threadedRuntime) {
    console.warn('OnRuntime child must be a threaded component.');
    return null;
  }

  return (
    <Threaded
      accessibilityLabel={accessibilityLabel}
      component={component}
      props={child.props}
      runtimeName={name}
      style={style}
      surfaceKey={surfaceKey}
      testID={testID}
    />
  );
}

export function ThreadedScreen<Props extends object>({
  accessibilityLabel,
  component,
  destroyOnUnmount = false,
  preload = true,
  props,
  runtimeName,
  style,
  surfaceKey,
  testID,
}: ThreadedScreenProps<Props>) {
  const threadedName = component.__threadedRuntime.name;
  const resolvedRuntimeName = runtimeName ?? `${threadedName}-screen`;

  useEffect(() => {
    if (preload) {
      void ThreadedRuntime.preload(resolvedRuntimeName);
    }

    return () => {
      if (destroyOnUnmount) {
        void ThreadedRuntime.destroy(resolvedRuntimeName);
      }
    };
  }, [destroyOnUnmount, preload, resolvedRuntimeName]);

  return (
    <Threaded
      accessibilityLabel={accessibilityLabel}
      component={component}
      props={props}
      runtimeName={resolvedRuntimeName}
      style={[THREADED_SCREEN_STYLE, style]}
      surfaceKey={surfaceKey ?? resolvedRuntimeName}
      testID={testID}
    />
  );
}

export function ThreadedReactSurface<Props extends object>({
  accessibilityLabel,
  componentName,
  initialProps,
  runtimeName = DEFAULT_RUNTIME_NAME,
  style,
  surfaceKey,
  testID,
}: ThreadedReactSurfaceProps<Props>) {
  const initialPropsJson = useMemo(
    () => JSON.stringify(initialProps ?? {}),
    [initialProps],
  );

  return (
    <NativeThreadedRuntimeSurface
      accessibilityLabel={accessibilityLabel}
      appName={DEFAULT_HOST_APP_NAME}
      componentName={componentName}
      initialPropsJson={initialPropsJson}
      runtimeName={runtimeName}
      style={style}
      surfaceKey={surfaceKey ?? componentName}
      testID={testID}
    />
  );
}

export function ThreadedRuntimeHost({
  componentName,
  initialPropsJson = '{}',
  runtimeName = DEFAULT_RUNTIME_NAME,
}: {
  componentName?: string;
  initialPropsJson?: string;
  runtimeName?: string;
}): ReactElement | null {
  if (!componentName) {
    console.warn('ThreadedRuntimeHost mounted without componentName');
    return null;
  }

  const loadComponent = threadedComponents.get(componentName);
  const Component = loadComponent?.();
  if (!Component) {
    console.warn(`No threaded component registered for "${componentName}"`);
    return null;
  }

  let initialProps: Record<string, unknown>;
  try {
    initialProps = JSON.parse(initialPropsJson);
  } catch {
    initialProps = {};
  }

  return <Component {...initialProps} runtimeName={runtimeName} />;
}

async function runRegisteredRuntimeFunction(
  functionId: string,
  argsJson: string,
  callId: string,
  runtimeName: string,
) {
  try {
    const result = await Promise.resolve(
      callRegisteredRuntimeFunction(functionId, argsJson),
    );
    await completeRuntimeFunctionCall(
      callId,
      JSON.stringify(result ?? null),
      null,
    );
  } catch (error) {
    await completeRuntimeFunctionCall(callId, null, {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'RuntimeFunctionError',
      stack: error instanceof Error ? error.stack : undefined,
      runtimeName,
    });
  }
}

function scheduleRegisteredRuntimeFunction(
  functionId: string,
  argsJson: string,
  _runtimeName: string,
) {
  try {
    void Promise.resolve(
      callRegisteredRuntimeFunction(functionId, argsJson),
    ).catch((error) => {
      console.warn(`Scheduled runtime function "${functionId}" failed`, error);
    });
  } catch (error) {
    console.warn(`Scheduled runtime function "${functionId}" failed`, error);
  }
}

function loadRegisteredRuntimeFunction(functionId: string) {
  const cached = loadedRuntimeFunctions.get(functionId);
  if (cached) {
    return cached;
  }

  const loadFunction = runtimeFunctions.get(functionId);
  if (!loadFunction) {
    throw Object.assign(
      new Error(`No runtime function registered for "${functionId}"`),
      { name: 'RuntimeFunctionNotFoundError' },
    );
  }

  const fn = loadFunction();
  loadedRuntimeFunctions.set(functionId, fn);
  return fn;
}

function callRegisteredRuntimeFunction(functionId: string, argsJson: string) {
  installRuntimeFunctionJsi();
  const jsiCall = (globalThis as RuntimeFunctionJsiGlobal)
    .__rnrCallRuntimeFunction;
  if (jsiCall) {
    return jsiCall(functionId, argsJson);
  }

  let args: unknown[];
  try {
    const parsedArgs = argsJson ? JSON.parse(argsJson) : [];
    args = Array.isArray(parsedArgs) ? parsedArgs : [parsedArgs];
  } catch (error) {
    throw Object.assign(
      new Error(`Invalid args for runtime function "${functionId}"`),
      {
        name: 'RuntimeFunctionArgsError',
        stack: error instanceof Error ? error.stack : undefined,
      },
    );
  }

  return loadRegisteredRuntimeFunction(functionId)(...args);
}

function completeRuntimeFunctionCall(
  callId: string,
  resultJson: string | null,
  error: {
    message: string;
    name?: string;
    stack?: string;
    runtimeName?: string;
  } | null,
) {
  const errorJson = error ? JSON.stringify(error) : null;
  return (
    nativeRuntime?.completeRuntimeFunctionCall?.(
      callId,
      resultJson,
      errorJson,
    ) ?? Promise.resolve()
  );
}

function prewarmRuntime(
  runtimeName: ThreadedRuntimeName = DEFAULT_RUNTIME_NAME,
  options: ThreadedRuntimePrewarmOptions = {},
) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return Promise.resolve();
  }
  const kind = options.kind ?? DEFAULT_RUNTIME_KIND;
  const useMainNativeModules = options.useMainNativeModules ?? false;
  if (nativeRuntime?.prewarmRuntimeWithOptions) {
    return nativeRuntime.prewarmRuntimeWithOptions(
      runtimeName,
      kind,
      useMainNativeModules,
    );
  }
  return (
    nativeRuntime?.prewarmRuntime?.(runtimeName) ??
    nativeRuntime?.preloadRuntime?.(runtimeName) ??
    Promise.resolve()
  );
}

export const ThreadedRuntime = {
  defaultRuntimeName: DEFAULT_RUNTIME_NAME,
  defaultBusinessRuntimeName: DEFAULT_BUSINESS_RUNTIME_NAME,

  preload(
    runtimeName: ThreadedRuntimeName = DEFAULT_RUNTIME_NAME,
    options: ThreadedRuntimePrewarmOptions = {},
  ) {
    return prewarmRuntime(runtimeName, options);
  },

  prewarm(
    runtimeName: ThreadedRuntimeName = DEFAULT_RUNTIME_NAME,
    options: ThreadedRuntimePrewarmOptions = {},
  ) {
    return prewarmRuntime(runtimeName, options);
  },

  prewarmBusinessRuntime(
    runtimeName: ThreadedRuntimeName = DEFAULT_BUSINESS_RUNTIME_NAME,
  ) {
    return prewarmRuntime(runtimeName, {
      kind: BUSINESS_RUNTIME_KIND,
      useMainNativeModules: true,
    });
  },

  async call<TFunction extends AnyFunction>(
    runtimeName: ThreadedRuntimeName,
    fn: RuntimeFunction<TFunction>,
    ...args: Parameters<TFunction>
  ): Promise<Awaited<ReturnType<TFunction>>> {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return Promise.resolve(fn(...args)) as Promise<
        Awaited<ReturnType<TFunction>>
      >;
    }

    const functionId = fn.__runtimeFunction?.id;
    if (!functionId) {
      return Promise.reject<Awaited<ReturnType<TFunction>>>(
        new Error(
          'Runtime function is missing generated metadata. Make sure it is ' +
            'exported as runtimeFunction(...) and Metro uses withThreadedRuntime(...).',
        ),
      );
    }

    const argsJson = JSON.stringify(args);
    const runtimeNitro = getRuntimeFunctionsNitro();
    if (runtimeNitro?.call) {
      try {
        const resultJson = await runtimeNitro.call(
          runtimeName,
          functionId,
          argsJson,
        );
        return JSON.parse(resultJson) as Awaited<ReturnType<TFunction>>;
      } catch (error) {
        if (!isRuntimeDispatcherMissing(error)) {
          throw error;
        }
      }
    }
    if (runtimeNitro?.run) {
      try {
        const resultJson = await runtimeNitro.run(
          runtimeName,
          functionId,
          argsJson,
        );
        return JSON.parse(resultJson) as Awaited<ReturnType<TFunction>>;
      } catch (error) {
        if (!isRuntimeDispatcherMissing(error)) {
          throw error;
        }
      }
    }

    const nativeCall = nativeRuntime?.call;
    if (!nativeCall) {
      return Promise.reject<Awaited<ReturnType<TFunction>>>(
        new Error(
          'ThreadedRuntime native module does not support runtime functions',
        ),
      );
    }

    const resultJson = await nativeCall(runtimeName, functionId, argsJson);
    return JSON.parse(resultJson) as Awaited<ReturnType<TFunction>>;
  },

  async schedule<TFunction extends AnyFunction>(
    runtimeName: ThreadedRuntimeName,
    fn: RuntimeFunction<TFunction> &
      RuntimeFunction<VoidReturningFunction<TFunction>>,
    ...args: Parameters<TFunction>
  ): Promise<void> {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      try {
        void Promise.resolve(fn(...args)).catch((error) => {
          console.warn(
            `Scheduled runtime function failed on "${runtimeName}"`,
            error,
          );
        });
      } catch (error) {
        console.warn(
          `Scheduled runtime function failed on "${runtimeName}"`,
          error,
        );
      }
      return;
    }

    const functionId = fn.__runtimeFunction?.id;
    if (!functionId) {
      return Promise.reject(
        new Error(
          'Runtime function is missing generated metadata. Make sure it is ' +
            'exported as runtimeFunction(...) and Metro uses withThreadedRuntime(...).',
        ),
      );
    }

    const argsJson = JSON.stringify(args);
    const runtimeNitro = getRuntimeFunctionsNitro();
    if (runtimeNitro?.schedule) {
      try {
        await runtimeNitro.schedule(runtimeName, functionId, argsJson);
        return;
      } catch (error) {
        if (!isRuntimeDispatcherMissing(error)) {
          throw error;
        }
      }
    }

    const scheduleRuntimeFunction = nativeRuntime?.schedule;
    if (!scheduleRuntimeFunction) {
      return Promise.reject(
        new Error(
          'ThreadedRuntime native module does not support scheduled runtime functions',
        ),
      );
    }

    await scheduleRuntimeFunction(runtimeName, functionId, argsJson);
  },

  runtime(runtimeName: ThreadedRuntimeName) {
    return {
      call<TFunction extends AnyFunction>(
        fn: RuntimeFunction<TFunction>,
        ...args: Parameters<TFunction>
      ) {
        return ThreadedRuntime.call(runtimeName, fn, ...args);
      },
      schedule<TFunction extends AnyFunction>(
        fn: RuntimeFunction<TFunction> &
          RuntimeFunction<VoidReturningFunction<TFunction>>,
        ...args: Parameters<TFunction>
      ) {
        return ThreadedRuntime.schedule(runtimeName, fn, ...args);
      },
    };
  },

  destroy(runtimeName: ThreadedRuntimeName = DEFAULT_RUNTIME_NAME) {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return Promise.resolve();
    }
    return nativeRuntime?.destroyRuntime?.(runtimeName) ?? Promise.resolve();
  },

  destroyAll() {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return Promise.resolve();
    }
    return nativeRuntime?.destroyAllRuntimes?.() ?? Promise.resolve();
  },

  getRuntimeNames() {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return Promise.resolve([] as string[]);
    }
    return (
      nativeRuntime?.getRuntimeNames?.() ?? Promise.resolve([] as string[])
    );
  },
};

const registerCallableModule =
  require('react-native/Libraries/Core/registerCallableModule').default as (
    name: string,
    moduleOrFactory: object | (() => object),
  ) => void;

function installThreadedRuntimeEventEmitterFallback() {
  const globals = globalThis as {
    __THREADED_RUNTIME_EVENT_EMITTER_FALLBACK__?: boolean;
  };
  if (
    Platform.OS !== 'ios' ||
    globals.__THREADED_RUNTIME_EVENT_EMITTER_FALLBACK__
  ) {
    return;
  }

  globals.__THREADED_RUNTIME_EVENT_EMITTER_FALLBACK__ = true;
  registerCallableModule('RCTEventEmitter', () => ({
    receiveEvent() {},
    receiveTouches() {},
  }));
}

installThreadedRuntimeEventEmitterFallback();

registerCallableModule(RUNTIME_FUNCTION_RUNNER_MODULE, () => ({
  run: runRegisteredRuntimeFunction,
  schedule: scheduleRegisteredRuntimeFunction,
}));
