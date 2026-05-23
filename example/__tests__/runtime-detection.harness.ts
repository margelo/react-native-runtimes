import { describe, expect, it } from 'react-native-harness';
import {
  getCurrentRuntime,
  getCurrentRuntimeName,
  isMainRuntime,
  MAIN_RUNTIME_NAME,
} from '@react-native-runtimes/core';

// These tests execute on the main RN runtime (the harness host runtime),
// so every assertion below is about the *main* runtime's self-identification.
// Cross-runtime detection (running these inside a worker via runOn) is
// covered in cross-runtime.harness.ts.

describe('getCurrentRuntime() on the main runtime', () => {
  it('reports isMain=true', () => {
    expect(getCurrentRuntime().isMain).toBe(true);
  });

  it('reports name = MAIN_RUNTIME_NAME ("main")', () => {
    expect(getCurrentRuntime().name).toBe(MAIN_RUNTIME_NAME);
    expect(MAIN_RUNTIME_NAME).toBe('main');
  });

  it('reports kind = null on main', () => {
    expect(getCurrentRuntime().kind).toBeNull();
  });

  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = getCurrentRuntime();
    const b = getCurrentRuntime();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('getCurrentRuntimeName() / isMainRuntime() shorthands', () => {
  it('getCurrentRuntimeName() returns "main" on the main runtime', () => {
    expect(getCurrentRuntimeName()).toBe('main');
  });

  it('isMainRuntime() returns true on the main runtime', () => {
    expect(isMainRuntime()).toBe(true);
  });

  it('isMainRuntime() and getCurrentRuntime().isMain agree', () => {
    expect(isMainRuntime()).toBe(getCurrentRuntime().isMain);
  });
});
