const { describe, expect, test } = require('bun:test');
const {
  getPlatformExtensionsFromMetroConfig,
  isRuntimeEntryFileName,
  runtimeEntryFromFileName,
} = require('../runtime-entry-files');

describe('runtime entry file names', () => {
  const metroOptions = {
    platformExtensions: ['android', 'ios', 'native'],
    sourceExtensions: ['js', 'jsx', 'ts', 'tsx'],
  };

  test('uses index.[runtime].[source] files as runtime entries', () => {
    expect(runtimeEntryFromFileName('index.business.js', metroOptions)).toEqual({
      platformExtension: null,
      requestBaseName: 'index.business',
      runtimeName: 'business',
      sourceExtension: 'js',
    });
    expect(isRuntimeEntryFileName('index.worker.ts', metroOptions)).toBe(true);
  });

  test('ignores configured platform extensions as runtime names', () => {
    expect(runtimeEntryFromFileName('index.ios.js', metroOptions)).toBeNull();
    expect(runtimeEntryFromFileName('index.android.ts', metroOptions)).toBeNull();
    expect(runtimeEntryFromFileName('index.native.tsx', metroOptions)).toBeNull();
  });

  test('strips configured platform extensions from platform-specific runtime entries', () => {
    expect(runtimeEntryFromFileName('index.business.ios.ts', metroOptions)).toEqual(
      {
        platformExtension: 'ios',
        requestBaseName: 'index.business',
        runtimeName: 'business',
        sourceExtension: 'ts',
      },
    );
  });

  test('rejects files that are not direct index runtime entries', () => {
    expect(runtimeEntryFromFileName('App.tsx', metroOptions)).toBeNull();
    expect(runtimeEntryFromFileName('index.js', metroOptions)).toBeNull();
    expect(runtimeEntryFromFileName('runtime.business.ts', metroOptions)).toBeNull();
    expect(runtimeEntryFromFileName('index.business.extra.ts', metroOptions)).toBeNull();
  });

  test('honors configured source extensions', () => {
    expect(
      runtimeEntryFromFileName('index.business.mjs', {
        platformExtensions: [],
        sourceExtensions: ['mjs'],
      }),
    ).toEqual({
      platformExtension: null,
      requestBaseName: 'index.business',
      runtimeName: 'business',
      sourceExtension: 'mjs',
    });
    expect(runtimeEntryFromFileName('index.business.ts', {
      platformExtensions: [],
      sourceExtensions: ['mjs'],
    })).toBeNull();
  });
});

describe('Metro config extraction', () => {
  test('extracts configured platform extensions from Metro resolver config', () => {
    expect(
      getPlatformExtensionsFromMetroConfig({
        resolver: {
          platforms: ['ios', 'android'],
        },
      }),
    ).toEqual(['ios', 'android', 'native']);
  });

  test('allows native platform extension extraction to be disabled', () => {
    expect(
      getPlatformExtensionsFromMetroConfig({
        resolver: {
          platforms: ['ios', 'android'],
          preferNativePlatform: false,
        },
      }),
    ).toEqual(['ios', 'android']);
  });
});
