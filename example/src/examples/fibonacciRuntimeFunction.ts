import { getCurrentRuntime, runtimeFunction } from '@react-native-runtimes/core';

export type FibonacciResult = {
  input: number;
  result: number;
  runtimeKind: string;
  runtimeName: string;
  computedAt: string;
};

function runtimeInfo() {
  const runtime = getCurrentRuntime();
  return {
    runtimeKind: runtime.kind ?? 'main',
    runtimeName: runtime.name,
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
