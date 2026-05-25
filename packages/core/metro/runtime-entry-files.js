const DEFAULT_SOURCE_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx'];

function getPlatformExtensionsFromMetroConfig(config) {
  const platformExtensions = normalizeExtensions(
    config?.resolver?.platforms || [],
  );
  if (
    config?.resolver?.preferNativePlatform !== false &&
    !platformExtensions.includes('native')
  ) {
    platformExtensions.push('native');
  }
  return platformExtensions;
}

function isRuntimeEntryFileName(fileName, options = {}) {
  return runtimeEntryFromFileName(fileName, options) !== null;
}

function runtimeEntryFromFileName(fileName, options = {}) {
  const platformExtensions = new Set(
    normalizeExtensions(options.platformExtensions || []),
  );
  const sourceExtensions = new Set(
    normalizeExtensions(options.sourceExtensions || DEFAULT_SOURCE_EXTENSIONS),
  );
  const baseName = fileName.split(/[\\/]/).pop();
  const parts = baseName.split('.');

  if (parts[0] !== 'index' || parts.length < 3) {
    return null;
  }

  const sourceExtension = parts.pop();
  if (!sourceExtensions.has(sourceExtension)) {
    return null;
  }

  let platformExtension = null;
  const lastNameSegment = parts[parts.length - 1];
  if (platformExtensions.has(lastNameSegment)) {
    platformExtension = parts.pop();
  }

  if (parts.length !== 2) {
    return null;
  }

  const runtimeName = parts[1];
  if (!runtimeName || platformExtensions.has(runtimeName)) {
    return null;
  }

  return {
    platformExtension,
    requestBaseName: `index.${runtimeName}`,
    runtimeName,
    sourceExtension,
  };
}

function normalizeExtensions(extensions) {
  return Array.from(extensions)
    .map(extension => String(extension).replace(/^\./, ''))
    .filter(Boolean);
}

module.exports = {
  DEFAULT_SOURCE_EXTENSIONS,
  getPlatformExtensionsFromMetroConfig,
  isRuntimeEntryFileName,
  normalizeExtensions,
  runtimeEntryFromFileName,
};
