const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const DEFAULT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  '.gradle',
  '.threaded-runtime',
  'android',
  'build',
  'ios',
  'node_modules',
]);
const IGNORED_FUNCTION_DIRECTIVES = new Set([
  'threaded',
  'use asm',
  'use strict',
  'worklet',
]);

const RUNTIME_ENTRY_PATTERN = /^index\.[^.]+\.ts$/;
const WATCH_DEBOUNCE_MS = 50;

function withThreadedRuntime(config, options = {}) {
  const projectRoot = path.resolve(
    options.projectRoot || config.projectRoot || process.cwd(),
  );
  const generatedDir = path.resolve(
    projectRoot,
    options.generatedDir || '.threaded-runtime',
  );
  const generatedEntry = path.resolve(
    generatedDir,
    options.generatedEntry || 'entry.js',
  );
  const roots = options.roots || ['App.tsx', 'src'];

  const regenerate = () => {
    try {
      generateThreadedRuntimeEntry({ generatedEntry, projectRoot, roots });
    } catch (error) {
      console.error(
        '[threaded-runtime] failed to regenerate entry:',
        error.message,
      );
    }
  };

  regenerate();

  if (options.watch !== false) {
    watchSources({ projectRoot, roots, onChange: regenerate });
  }

  const baseGetPolyfills = config.serializer && config.serializer.getPolyfills;

  return {
    ...config,
    transformer: {
      ...(config.transformer || {}),
      babelTransformerPath: path.join(__dirname, 'metro-transformer.js'),
    },
    serializer: {
      ...(config.serializer || {}),
      // Secondary runtimes don't get Expo's native `global.expo` host installed;
      // prepend a polyfill (runs before every module, in every runtime) that
      // stubs it so expo-modules-core's load-time reads don't crash them. Inert
      // on bare React Native.
      getPolyfills: (opts) => [
        ...(baseGetPolyfills ? baseGetPolyfills(opts) : []),
        path.join(__dirname, 'secondary-runtime-polyfill.js'),
      ],
    },
    watchFolders: Array.from(
      new Set([...(config.watchFolders || []), generatedDir]),
    ),
  };
}

function watchSources({ projectRoot, roots, onChange }) {
  let timeout = null;
  const schedule = () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      onChange();
    }, WATCH_DEBOUNCE_MS);
  };

  const watchers = [];
  const watchDir = (dir, recursive, filter) => {
    try {
      const watcher = fs.watch(dir, { recursive }, (_event, filename) => {
        if (!filename) {
          return;
        }
        if (filter(filename)) {
          schedule();
        }
      });
      if (typeof watcher.unref === 'function') {
        watcher.unref();
      }
      watchers.push(watcher);
    } catch (error) {
      console.warn(
        `[threaded-runtime] could not watch ${dir}: ${error.message}`,
      );
    }
  };

  const fileRootsAtProjectRoot = new Set();
  const dirRootsAbsolute = [];
  roots.forEach(rootPath => {
    const absolute = path.resolve(projectRoot, rootPath);
    if (!fs.existsSync(absolute)) {
      return;
    }
    const stat = fs.statSync(absolute);
    if (stat.isFile() && path.dirname(absolute) === projectRoot) {
      fileRootsAtProjectRoot.add(path.basename(absolute));
    } else if (stat.isDirectory()) {
      dirRootsAbsolute.push(absolute);
    }
  });

  watchDir(projectRoot, false, filename => {
    if (RUNTIME_ENTRY_PATTERN.test(filename)) {
      return true;
    }
    return fileRootsAtProjectRoot.has(filename);
  });

  dirRootsAbsolute.forEach(absRoot => {
    watchDir(absRoot, true, filename => {
      const parts = filename.split(path.sep);
      if (parts.some(part => DEFAULT_IGNORED_DIRS.has(part))) {
        return false;
      }
      return DEFAULT_EXTENSIONS.has(path.extname(filename));
    });
  });

  const cleanup = () => {
    watchers.forEach(watcher => {
      try {
        watcher.close();
      } catch (_) {}
    });
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit();
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit();
  });
}

function generateThreadedRuntimeEntry({
  generatedEntry,
  projectRoot = process.cwd(),
  roots = ['App.tsx', 'src'],
}) {
  const root = path.resolve(projectRoot);
  const files = collectSourceFiles(root, roots);
  const components = files.flatMap(file => scanThreadedComponents(file, root));
  const runtimeFunctions = files.flatMap(file =>
    scanRuntimeFunctions(file, root),
  );
  const runtimeEntries = collectRuntimeEntryFiles(root);
  const seenNames = new Map();
  const seenRuntimeFunctionIds = new Map();

  components.forEach(component => {
    const existing = seenNames.get(component.name);
    if (existing) {
      throw new Error(
        `Duplicate threaded component name "${component.name}" in ` +
          `${component.file} and ${existing.file}`,
      );
    }
    seenNames.set(component.name, component);
  });

  components.sort((left, right) => left.name.localeCompare(right.name));

  runtimeFunctions.forEach(runtimeFunction => {
    const existing = seenRuntimeFunctionIds.get(runtimeFunction.id);
    if (existing) {
      throw new Error(
        `Duplicate runtime function id "${runtimeFunction.id}" in ` +
          `${runtimeFunction.file} and ${existing.file}`,
      );
    }
    seenRuntimeFunctionIds.set(runtimeFunction.id, runtimeFunction);
  });

  runtimeFunctions.sort((left, right) => left.id.localeCompare(right.id));

  const source = renderGeneratedEntry({
    components,
    generatedEntry,
    projectRoot: root,
    runtimeFunctions,
    runtimeEntries,
  });
  fs.mkdirSync(path.dirname(generatedEntry), { recursive: true });
  if (
    !fs.existsSync(generatedEntry) ||
    fs.readFileSync(generatedEntry, 'utf8') !== source
  ) {
    fs.writeFileSync(generatedEntry, source);
  }

  return {
    components,
    generatedEntry,
    runtimeFunctions,
    runtimeEntries,
  };
}

function collectRuntimeEntryFiles(projectRoot) {
  if (!fs.existsSync(projectRoot)) {
    return [];
  }

  return fs
    .readdirSync(projectRoot, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .map(fileName => {
      const match = /^index\.([^.]+)\.ts$/.exec(fileName);
      if (!match) {
        return null;
      }
      return {
        file: path.join(projectRoot, fileName),
        runtimeName: match[1],
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.runtimeName.localeCompare(right.runtimeName));
}

function collectSourceFiles(projectRoot, roots) {
  const files = [];

  roots.forEach(rootPath => {
    const absoluteRoot = path.resolve(projectRoot, rootPath);
    if (!fs.existsSync(absoluteRoot)) {
      return;
    }
    const stat = fs.statSync(absoluteRoot);
    if (stat.isFile()) {
      if (DEFAULT_EXTENSIONS.has(path.extname(absoluteRoot))) {
        files.push(absoluteRoot);
      }
      return;
    }
    if (stat.isDirectory()) {
      walkDirectory(absoluteRoot, files);
    }
  });

  return files.sort();
}

function walkDirectory(directory, files) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORED_DIRS.has(entry.name)) {
        walkDirectory(absolutePath, files);
      }
      return;
    }

    if (entry.isFile() && DEFAULT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  });
}

function scanThreadedComponents(file, projectRoot) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(source, {
    errorRecovery: true,
    plugins: ['jsx', 'typescript'],
    sourceType: 'module',
  });
  const components = [];
  const onRuntimeComponentNames = collectOnRuntimeComponentNames(ast);

  traverse(ast, {
    Program(pathRef) {
      pathRef.get('body').forEach(bodyPath => {
        let functionPath = bodyPath;
        if (bodyPath.isExportNamedDeclaration()) {
          const declarationPath = bodyPath.get('declaration');
          if (!declarationPath.isFunctionDeclaration()) {
            return;
          }
          functionPath = declarationPath;
        }

        if (!functionPath.isFunctionDeclaration()) {
          return;
        }

        const functionNode = functionPath.node;
        if (!onRuntimeComponentNames.has(functionNode.id.name)) {
          return;
        }

        components.push({
          exportName: functionNode.id.name,
          file,
          name: threadedComponentId(file, projectRoot, functionNode.id.name),
        });
      });
    },

    ExportNamedDeclaration(pathRef) {
      const declaration = pathRef.node.declaration;
      if (!declaration || declaration.type !== 'VariableDeclaration') {
        return;
      }

      declaration.declarations.forEach(declarator => {
        if (declarator.id.type !== 'Identifier') {
          return;
        }
        if (!isThreadedComponentCall(declarator.init)) {
          return;
        }
        const nameNode = declarator.init.arguments[0];
        if (!nameNode || nameNode.type !== 'StringLiteral') {
          throw new Error(
            `threadedComponent export ${declarator.id.name} in ${file} ` +
              'must use a string literal name',
          );
        }

        components.push({
          exportName: declarator.id.name,
          file,
          name: nameNode.value,
        });
      });
    },
  });

  return components;
}

function scanRuntimeFunctions(file, projectRoot) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(source, {
    errorRecovery: true,
    plugins: ['jsx', 'typescript'],
    sourceType: 'module',
  });
  const runtimeFunctions = [];

  traverse(ast, {
    Program(pathRef) {
      pathRef.get('body').forEach(bodyPath => {
        let functionPath = bodyPath;
        if (bodyPath.isExportNamedDeclaration()) {
          const declarationPath = bodyPath.get('declaration');
          if (!declarationPath.isFunctionDeclaration()) {
            return;
          }
          functionPath = declarationPath;
        }

        if (!functionPath.isFunctionDeclaration()) {
          return;
        }

        const functionNode = functionPath.node;
        const runtimeName = runtimeNameFromFunctionDirective(functionNode);
        if (!runtimeName) {
          return;
        }

        const exportName = runtimeFunctionShortcutName(functionNode.id.name);
        runtimeFunctions.push({
          exportName,
          file,
          id: runtimeFunctionId(file, projectRoot, exportName),
        });
      });
    },

    ExportNamedDeclaration(pathRef) {
      const declaration = pathRef.node.declaration;
      if (!declaration || declaration.type !== 'VariableDeclaration') {
        return;
      }

      declaration.declarations.forEach(declarator => {
        if (declarator.id.type !== 'Identifier') {
          return;
        }
        if (!isRuntimeFunctionCall(declarator.init)) {
          return;
        }

        runtimeFunctions.push({
          exportName: declarator.id.name,
          file,
          id:
            explicitRuntimeFunctionId(declarator.init) ??
            runtimeFunctionId(file, projectRoot, declarator.id.name),
        });
      });
    },
  });

  return runtimeFunctions;
}

function runtimeFunctionShortcutName(functionName) {
  return `${functionName}_`;
}

function runtimeNameFromFunctionDirective(node) {
  if (
    !node ||
    node.type !== 'FunctionDeclaration' ||
    !node.id ||
    !node.body?.directives?.length
  ) {
    return null;
  }

  const runtimeName = node.body.directives[0].value.value;
  if (!runtimeName || IGNORED_FUNCTION_DIRECTIVES.has(runtimeName)) {
    return null;
  }

  return runtimeName;
}

function isThreadedComponentCall(node) {
  if (!node || node.type !== 'CallExpression') {
    return false;
  }
  const callee = node.callee;
  return callee.type === 'Identifier' && callee.name === 'threadedComponent';
}

function onRuntimeChildNameFromJsxElement(node) {
  if (
    node.openingElement.name.type !== 'JSXIdentifier' ||
    node.openingElement.name.name !== 'OnRuntime'
  ) {
    return null;
  }

  const children = node.children.filter(child => {
    if (child.type === 'JSXText') {
      return child.value.trim().length > 0;
    }
    if (
      child.type === 'JSXExpressionContainer' &&
      child.expression.type === 'JSXEmptyExpression'
    ) {
      return false;
    }
    return true;
  });

  if (children.length !== 1 || children[0].type !== 'JSXElement') {
    return null;
  }

  const childName = children[0].openingElement.name;
  return childName.type === 'JSXIdentifier' ? childName.name : null;
}

function collectOnRuntimeComponentNames(ast) {
  const componentNames = new Set();
  traverse(ast, {
    JSXElement(pathRef) {
      const componentName = onRuntimeChildNameFromJsxElement(pathRef.node);
      if (componentName) {
        componentNames.add(componentName);
      }
    },
  });
  return componentNames;
}

function isRuntimeFunctionCall(node) {
  if (!node || node.type !== 'CallExpression') {
    return false;
  }
  const callee = node.callee;
  if (callee.type === 'Identifier' && callee.name === 'runtimeFunction') {
    return true;
  }
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'runtimeFunction' &&
    callee.property.type === 'Identifier' &&
    (callee.property.name === 'named' || callee.property.name === 'withId')
  );
}

function explicitRuntimeFunctionId(node) {
  if (!node || node.type !== 'CallExpression') {
    return null;
  }
  const callee = node.callee;
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.object.type !== 'Identifier' ||
    callee.object.name !== 'runtimeFunction' ||
    callee.property.type !== 'Identifier' ||
    (callee.property.name !== 'named' && callee.property.name !== 'withId')
  ) {
    return null;
  }
  const idNode = node.arguments[0];
  return idNode?.type === 'StringLiteral' ? idNode.value : null;
}

function runtimeFunctionId(file, projectRoot, exportName) {
  const withoutExtension = file.slice(0, -path.extname(file).length);
  return `${toPosixPath(
    path.relative(projectRoot, withoutExtension),
  )}.${exportName}`;
}

function threadedComponentId(file, projectRoot, exportName) {
  return runtimeFunctionId(file, projectRoot, exportName);
}

function renderGeneratedEntry({
  components,
  generatedEntry,
  projectRoot,
  runtimeFunctions,
  runtimeEntries,
}) {
  const generatedDir = path.dirname(generatedEntry);
  const registrations = components
    .map(component => {
      const requestPath = toRequirePath(generatedDir, component.file);
      return (
        `registerLazyThreadedComponent(${JSON.stringify(
          component.name,
        )}, () =>\n` +
        `  require(${JSON.stringify(requestPath)}).${component.exportName},\n` +
        ');'
      );
    })
    .join('\n\n');
  const runtimeEntryDispatch = renderRuntimeEntryDispatch({
    generatedDir,
    runtimeEntries,
  });
  const runtimeFunctionRegistrations = renderRuntimeFunctionRegistrations({
    generatedDir,
    runtimeFunctions,
  });

  return (
    `// @generated by @react-native-runtimes/core/metro\n` +
    `// projectRoot: ${toPosixPath(projectRoot)}\n` +
    `import {AppRegistry} from 'react-native';\n` +
    `import {\n` +
    `  ThreadedRuntimeHost,\n` +
    `  registerLazyThreadedComponent,\n` +
    `  registerRuntimeFunction,\n` +
    `} from '@react-native-runtimes/core';\n\n` +
    `${runtimeEntryDispatch}` +
    `${runtimeFunctionRegistrations}` +
    `${registrations}\n\n` +
    `AppRegistry.registerComponent('ThreadedRuntimeHost', () => ThreadedRuntimeHost);\n`
  );
}

function renderRuntimeFunctionRegistrations({
  generatedDir,
  runtimeFunctions,
}) {
  if (!runtimeFunctions.length) {
    return '';
  }

  return (
    runtimeFunctions
      .map(runtimeFunction => {
        const requestPath = toRequirePath(generatedDir, runtimeFunction.file);
        return (
          `registerRuntimeFunction(${JSON.stringify(
            runtimeFunction.id,
          )}, () =>\n` +
          `  require(${JSON.stringify(requestPath)}).${
            runtimeFunction.exportName
          },\n` +
          ');'
        );
      })
      .join('\n\n') + '\n\n'
  );
}

function renderRuntimeEntryDispatch({ generatedDir, runtimeEntries }) {
  if (!runtimeEntries.length) {
    return '';
  }

  const branches = runtimeEntries
    .map((entry, index) => {
      const requestPath = toRequirePath(generatedDir, entry.file);
      const keyword = index === 0 ? 'if' : 'else if';
      const runtimeName = JSON.stringify(entry.runtimeName);
      return (
        `${keyword} (threadedRuntimeName === ${runtimeName} || ` +
        `threadedRuntimeKind === ${runtimeName}) {\n` +
        `  require(${JSON.stringify(requestPath)});\n` +
        `}`
      );
    })
    .join(' ');

  return (
    `const threadedRuntimeEnv = global.__THREADED_RUNTIME_ENV__;\n` +
    `const threadedRuntimeName = threadedRuntimeEnv?.runtimeName;\n` +
    `const threadedRuntimeKind = threadedRuntimeEnv?.kind;\n\n` +
    `${branches}\n\n`
  );
}

function toRequirePath(fromDirectory, file) {
  const withoutExtension = file.slice(0, -path.extname(file).length);
  let relativePath = toPosixPath(
    path.relative(fromDirectory, withoutExtension),
  );
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

module.exports = {
  generateThreadedRuntimeEntry,
  withThreadedRuntime,
};
