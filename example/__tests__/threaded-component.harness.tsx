import React from 'react';
import { Text } from 'react-native';
import { describe, expect, it } from 'react-native-harness';
import {
  registerLazyThreadedComponent,
  registerThreadedComponent,
  threadedComponent,
} from '@react-native-runtimes/core';

function makeComponent(label: string) {
  return function Demo() {
    return <Text>{label}</Text>;
  };
}

describe('threadedComponent()', () => {
  it('attaches __threadedRuntime.name to the component', () => {
    const Demo = threadedComponent('test/threaded.attach', makeComponent('a'));
    expect(Demo.__threadedRuntime.name).toBe('test/threaded.attach');
  });

  it('returns the same object reference (mutates in place)', () => {
    const original = makeComponent('same-ref');
    const wrapped = threadedComponent('test/threaded.sameRef', original);
    expect(wrapped).toBe(original);
  });

  it('allows different names on different components', () => {
    const A = threadedComponent('test/threaded.A', makeComponent('A'));
    const B = threadedComponent('test/threaded.B', makeComponent('B'));
    expect(A.__threadedRuntime.name).toBe('test/threaded.A');
    expect(B.__threadedRuntime.name).toBe('test/threaded.B');
  });
});

describe('registerThreadedComponent()', () => {
  it('registers without throwing', () => {
    expect(() =>
      registerThreadedComponent(
        'test/register.eager',
        makeComponent('eager'),
      ),
    ).not.toThrow();
  });

  it('allows re-registration of the same name', () => {
    expect(() => {
      registerThreadedComponent(
        'test/register.overwrite',
        makeComponent('first'),
      );
      registerThreadedComponent(
        'test/register.overwrite',
        makeComponent('second'),
      );
    }).not.toThrow();
  });
});

describe('registerLazyThreadedComponent()', () => {
  it('does not invoke the loader at registration time', () => {
    let invoked = 0;
    registerLazyThreadedComponent('test/register.lazy', () => {
      invoked += 1;
      return makeComponent('lazy');
    });
    expect(invoked).toBe(0);
  });

  it('coexists with eager registration for distinct names', () => {
    expect(() => {
      registerThreadedComponent(
        'test/register.coexistA',
        makeComponent('eager'),
      );
      registerLazyThreadedComponent('test/register.coexistB', () =>
        makeComponent('lazy'),
      );
    }).not.toThrow();
  });
});
