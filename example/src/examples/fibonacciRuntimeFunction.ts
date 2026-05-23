import { runtimeFunction } from '@react-native-runtimes/core';

export type FibonacciResult = {
  input: number;
  result: number;
  runtimeKind: string;
  runtimeName: string;
  computedAt: string;
};

function runtimeInfo() {
  const globals = globalThis as {
    __THREADED_RUNTIME_ENV__?: { kind?: string; runtimeName?: string };
    __COMPOSE_CHAT_LIST_ENV__?: { kind?: string; runtimeName?: string };
  };
  const threadedEnv = globals.__THREADED_RUNTIME_ENV__;
  const listEnv = globals.__COMPOSE_CHAT_LIST_ENV__;
  return {
    runtimeKind: threadedEnv?.kind ?? listEnv?.kind ?? 'main',
    runtimeName: threadedEnv?.runtimeName ?? listEnv?.runtimeName ?? 'main',
  };
}

function fibonacciNumber(n: number) {
  if (n < 2) {
    return n;
  }

  let previous = 0;
  let current = 1;
  for (let index = 2; index <= n; index += 1) {
    const next = previous + current;
    previous = current;
    current = next;
  }
  return current;
}

export const fibonacci = runtimeFunction((n: number): FibonacciResult => {
  const normalizedInput = Math.max(0, Math.min(45, Math.floor(n)));
  return {
    input: normalizedInput,
    result: fibonacciNumber(normalizedInput),
    ...runtimeInfo(),
    computedAt: new Date().toISOString(),
  };
});
