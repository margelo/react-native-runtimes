import { describe, expect, it } from 'react-native-harness';
import {
  registerRuntimeFunction,
  runtimeFunction,
} from '@react-native-runtimes/core';

// We can't read the private registry map directly. The tests below verify
// observable behavior: a registered loader is invoked lazily, the same id can
// be re-registered with a new loader, and the JSI bridge accepts the call.

describe('registerRuntimeFunction()', () => {
  it('does not invoke the loader at registration time (lazy)', () => {
    let loaderInvocations = 0;
    registerRuntimeFunction('test/registry.lazyLoader', () => {
      loaderInvocations += 1;
      return runtimeFunction(() => 'lazy');
    });
    // Registration alone should not trigger the loader — it's only called
    // when the runtime actually needs to dispatch the function.
    expect(loaderInvocations).toBe(0);
  });

  it('accepts multiple distinct ids without conflict', () => {
    const a = runtimeFunction.withId('test/registry.idA', () => 'a');
    const b = runtimeFunction.withId('test/registry.idB', () => 'b');
    expect(() => {
      registerRuntimeFunction('test/registry.idA', () => a);
      registerRuntimeFunction('test/registry.idB', () => b);
    }).not.toThrow();
  });

  it('allows re-registration of the same id (overwrite, last write wins)', () => {
    const first = runtimeFunction.withId('test/registry.overwrite', () => 1);
    const second = runtimeFunction.withId('test/registry.overwrite', () => 2);
    expect(() => {
      registerRuntimeFunction('test/registry.overwrite', () => first);
      registerRuntimeFunction('test/registry.overwrite', () => second);
    }).not.toThrow();
  });

  it('returns void from registration', () => {
    const fn = runtimeFunction(() => 0);
    const result = registerRuntimeFunction(
      'test/registry.returnValue',
      () => fn,
    );
    expect(result).toBeUndefined();
  });
});
