import { describe, expect, it } from 'react-native-harness';
import { call, runtimeFunction } from '@react-native-runtimes/core';

describe('runtimeFunction()', () => {
  it('returns a callable that invokes the wrapped fn in-place', () => {
    const wrapped = runtimeFunction((a: number, b: number) => a + b);
    expect(wrapped(2, 3)).toBe(5);
  });

  it('attaches a runOn method to the returned function', () => {
    const wrapped = runtimeFunction(() => 'ok');
    expect(typeof wrapped.runOn).toBe('function');
  });

  it('does not attach __runtimeFunction metadata when no id is provided', () => {
    const wrapped = runtimeFunction(() => 1);
    expect(wrapped.__runtimeFunction).toBeUndefined();
  });

  it('preserves the wrapped function reference identity (same object)', () => {
    const original = (n: number) => n * 2;
    const wrapped = runtimeFunction(original);
    expect(wrapped).toBe(original);
  });
});

describe('runtimeFunction.withId() / .named()', () => {
  it('attaches __runtimeFunction.id when constructed via .withId', () => {
    const fn = runtimeFunction.withId('test/withId.demo', (n: number) => n);
    expect(fn.__runtimeFunction).toBeDefined();
    expect(fn.__runtimeFunction?.id).toBe('test/withId.demo');
  });

  it('.named is an alias for .withId', () => {
    const fn = runtimeFunction.named('test/named.demo', (n: number) => n);
    expect(fn.__runtimeFunction?.id).toBe('test/named.demo');
  });

  it('still exposes runOn on the constructed function', () => {
    const fn = runtimeFunction.withId('test/withId.runOn', () => 0);
    expect(typeof fn.runOn).toBe('function');
  });

  it('treats withId(fn) with empty id as still annotated', () => {
    // Empty id is falsy in attachRuntimeFunction, so no metadata is attached.
    const fn = runtimeFunction.withId('', () => 0);
    expect(fn.__runtimeFunction).toBeUndefined();
  });
});

describe('call(fn).on(runtime)', () => {
  it('returns a builder with an .on(runtimeName) method', () => {
    const fn = runtimeFunction(() => 1);
    const builder = call(fn);
    expect(typeof builder.on).toBe('function');
  });

  it('.on(runtime) returns an invoker function', () => {
    const fn = runtimeFunction(() => 1);
    const invoker = call(fn).on('any-runtime');
    expect(typeof invoker).toBe('function');
  });
});
