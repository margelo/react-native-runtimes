const path = require('path');

const IGNORED_FUNCTION_DIRECTIVES = new Set([
  'threaded',
  'use asm',
  'use strict',
  'worklet',
]);

function runtimeFunctionId(filename, projectRoot, exportName) {
  const root = projectRoot ? path.resolve(projectRoot) : process.cwd();
  const extension = path.extname(filename);
  const withoutExtension = filename.slice(0, -extension.length);
  const relativePath = path
    .relative(root, withoutExtension)
    .split(path.sep)
    .join('/');
  return `${relativePath}.${exportName}`;
}

function threadedComponentId(filename, projectRoot, exportName) {
  return runtimeFunctionId(filename, projectRoot, exportName);
}

function runtimeFunctionNameFromCall(node) {
  if (!node || node.type !== 'CallExpression') {
    return undefined;
  }

  const callee = node.callee;
  if (callee.type === 'Identifier' && callee.name === 'runtimeFunction') {
    return null;
  }

  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'runtimeFunction' &&
    callee.property.type === 'Identifier' &&
    (callee.property.name === 'named' || callee.property.name === 'withId')
  ) {
    const nameNode = node.arguments[0];
    return nameNode?.type === 'StringLiteral' ? nameNode.value : null;
  }

  return undefined;
}

function isRuntimeFunctionCall(node) {
  return runtimeFunctionNameFromCall(node) !== undefined;
}

function isBareRuntimeFunctionCall(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'runtimeFunction'
  );
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

function shouldTransformFile(filename, projectRoot) {
  if (!filename) {
    return false;
  }
  if (filename.includes(`${path.sep}node_modules${path.sep}`)) {
    return false;
  }
  if (!projectRoot) {
    return true;
  }
  const relativePath = path.relative(path.resolve(projectRoot), filename);
  return (
    relativePath &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath)
  );
}

function onRuntimeChildNameFromJsxElement(node) {
  if (
    node.openingElement.name.type !== 'JSXIdentifier' ||
    node.openingElement.name.name !== 'OnRuntime'
  ) {
    return null;
  }

  const children = node.children.filter((child) => {
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

function collectOnRuntimeComponentNames(programPath) {
  const componentNames = new Set();
  programPath.traverse({
    JSXElement(jsxPath) {
      const componentName = onRuntimeChildNameFromJsxElement(jsxPath.node);
      if (componentName) {
        componentNames.add(componentName);
      }
    },
  });
  return componentNames;
}

function extractRuntimeCall(node) {
  if (!node) {
    return null;
  }

  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    return node;
  }

  return null;
}

function extractCallbackCall(callbackNode) {
  if (
    callbackNode.type !== 'ArrowFunctionExpression' &&
    callbackNode.type !== 'FunctionExpression'
  ) {
    return null;
  }

  if (callbackNode.params.length > 0) {
    return null;
  }

  if (callbackNode.body.type !== 'BlockStatement') {
    return extractRuntimeCall(callbackNode.body);
  }

  if (callbackNode.body.body.length !== 1) {
    return null;
  }

  const statement = callbackNode.body.body[0];
  if (statement.type !== 'ReturnStatement') {
    return null;
  }

  return extractRuntimeCall(statement.argument);
}

function extractCallOnRuntimeCall(node) {
  if (!node || node.type !== 'CallExpression') {
    return null;
  }

  const onCall = node.callee;
  if (onCall.type !== 'CallExpression') {
    return null;
  }

  const onCallee = onCall.callee;
  if (
    onCallee.type !== 'MemberExpression' ||
    onCallee.computed ||
    onCallee.property.type !== 'Identifier' ||
    onCallee.property.name !== 'on'
  ) {
    return null;
  }

  const callExpression = onCallee.object;
  if (
    callExpression.type !== 'CallExpression' ||
    callExpression.callee.type !== 'Identifier' ||
    (callExpression.callee.name !== 'call' &&
      callExpression.callee.name !== 'schedule')
  ) {
    return null;
  }

  const scheduledFunction = callExpression.arguments[0];
  const runtimeArg = onCall.arguments[0];
  if (!scheduledFunction || !runtimeArg) {
    return null;
  }

  if (scheduledFunction.type !== 'Identifier') {
    return null;
  }

  return {
    methodName:
      callExpression.callee.name === 'schedule' ? 'scheduleOn' : 'runOn',
    scheduledFunction,
    runtimeArg,
    args: node.arguments,
  };
}

function ensureRuntimeShortcutImports(programPath, t) {
  const callIdentifier = programPath.scope.generateUidIdentifier('rnrCall');
  const runtimeFunctionIdentifier =
    programPath.scope.generateUidIdentifier('rnrRuntimeFunction');

  const importDeclaration = t.importDeclaration(
    [
      t.importSpecifier(callIdentifier, t.identifier('call')),
      t.importSpecifier(
        runtimeFunctionIdentifier,
        t.identifier('runtimeFunction'),
      ),
    ],
    t.stringLiteral('@react-native-runtimes/core'),
  );

  const bodyPaths = programPath.get('body');
  const lastImportPath = bodyPaths
    .filter((bodyPath) => bodyPath.isImportDeclaration())
    .at(-1);

  if (lastImportPath) {
    lastImportPath.insertAfter(importDeclaration);
  } else {
    programPath.unshiftContainer('body', importDeclaration);
  }

  return { callIdentifier, runtimeFunctionIdentifier };
}

function ensureThreadedComponentImport(programPath, t) {
  const threadedComponentIdentifier = programPath.scope.generateUidIdentifier(
    'rnrThreadedComponent',
  );

  const importDeclaration = t.importDeclaration(
    [
      t.importSpecifier(
        threadedComponentIdentifier,
        t.identifier('threadedComponent'),
      ),
    ],
    t.stringLiteral('@react-native-runtimes/core'),
  );

  const bodyPaths = programPath.get('body');
  const lastImportPath = bodyPaths
    .filter((bodyPath) => bodyPath.isImportDeclaration())
    .at(-1);

  if (lastImportPath) {
    lastImportPath.insertAfter(importDeclaration);
  } else {
    programPath.unshiftContainer('body', importDeclaration);
  }

  return threadedComponentIdentifier;
}

function createThreadedComponentDeclaration({
  functionNode,
  threadedComponentIdentifier,
  threadedComponentIdValue,
  t,
}) {
  const originalName = functionNode.id.name;
  const functionExpression = t.functionExpression(
    t.identifier(originalName),
    functionNode.params,
    functionNode.body,
    functionNode.generator,
    functionNode.async,
  );
  functionExpression.returnType = functionNode.returnType;
  functionExpression.typeParameters = functionNode.typeParameters;

  return t.exportNamedDeclaration(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(originalName),
        t.callExpression(threadedComponentIdentifier, [
          t.stringLiteral(threadedComponentIdValue),
          functionExpression,
        ]),
      ),
    ]),
  );
}

function createRuntimeShortcutStatements({
  callIdentifier,
  exportAlias,
  functionNode,
  runtimeFunctionIdentifier,
  runtimeFunctionIdValue,
  runtimeName,
  t,
}) {
  const originalName = functionNode.id.name;
  const runtimeFunctionName = runtimeFunctionShortcutName(originalName);
  const functionExpression = t.functionExpression(
    t.identifier(originalName),
    functionNode.params,
    functionNode.body,
    functionNode.generator,
    functionNode.async,
  );
  functionExpression.returnType = functionNode.returnType;
  functionExpression.typeParameters = functionNode.typeParameters;

  const runtimeFunctionDeclaration = t.exportNamedDeclaration(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(runtimeFunctionName),
        t.callExpression(
          t.memberExpression(runtimeFunctionIdentifier, t.identifier('withId')),
          [t.stringLiteral(runtimeFunctionIdValue), functionExpression],
        ),
      ),
    ]),
  );

  const scheduledFunctionDeclaration = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier(originalName),
      t.callExpression(
        t.memberExpression(
          t.callExpression(callIdentifier, [t.identifier(runtimeFunctionName)]),
          t.identifier('on'),
        ),
        [t.stringLiteral(runtimeName)],
      ),
    ),
  ]);

  if (exportAlias) {
    return [
      runtimeFunctionDeclaration,
      t.exportNamedDeclaration(scheduledFunctionDeclaration),
    ];
  }

  return [runtimeFunctionDeclaration, scheduledFunctionDeclaration];
}

module.exports = function runtimeFunctionBabelPlugin({ types: t }) {
  return {
    name: '@react-native-runtimes/runtime-function',
    visitor: {
      Program(programPath, state) {
        if (
          !shouldTransformFile(state.file.opts.filename, state.opts.projectRoot)
        ) {
          return;
        }

        const onRuntimeComponentNames =
          collectOnRuntimeComponentNames(programPath);
        const runtimeShortcutReplacements = [];
        const threadedComponentReplacements = [];
        programPath.get('body').forEach((bodyPath) => {
          let functionPath = bodyPath;
          let exportAlias = false;
          if (bodyPath.isExportNamedDeclaration()) {
            const declarationPath = bodyPath.get('declaration');
            if (!declarationPath.isFunctionDeclaration()) {
              return;
            }
            functionPath = declarationPath;
            exportAlias = true;
          }

          if (!functionPath.isFunctionDeclaration()) {
            return;
          }

          const functionNode = functionPath.node;
          if (onRuntimeComponentNames.has(functionNode.id.name)) {
            threadedComponentReplacements.push({
              bodyPath,
              functionNode,
              threadedComponentIdValue: threadedComponentId(
                state.file.opts.filename,
                state.opts.projectRoot,
                functionNode.id.name,
              ),
            });
            return;
          }

          const runtimeName = runtimeNameFromFunctionDirective(functionNode);
          if (!runtimeName) {
            return;
          }

          const originalName = functionNode.id.name;
          const runtimeFunctionName = runtimeFunctionShortcutName(originalName);
          if (
            programPath.scope.hasBinding(runtimeFunctionName) &&
            runtimeFunctionName !== originalName
          ) {
            throw functionPath.buildCodeFrameError(
              `Runtime function shortcut for "${originalName}" needs generated binding "${runtimeFunctionName}", but that name is already used.`,
            );
          }

          runtimeShortcutReplacements.push({
            bodyPath,
            exportAlias,
            functionNode,
            runtimeFunctionIdValue: runtimeFunctionId(
              state.file.opts.filename,
              state.opts.projectRoot,
              runtimeFunctionName,
            ),
            runtimeName,
          });
        });

        if (
          !runtimeShortcutReplacements.length &&
          !threadedComponentReplacements.length
        ) {
          return;
        }

        let threadedComponentIdentifier = null;
        if (threadedComponentReplacements.length) {
          threadedComponentIdentifier = ensureThreadedComponentImport(
            programPath,
            t,
          );
        }

        let runtimeShortcutImports = null;
        if (runtimeShortcutReplacements.length) {
          runtimeShortcutImports = ensureRuntimeShortcutImports(programPath, t);
        }

        threadedComponentReplacements.forEach((replacement) => {
          replacement.bodyPath.replaceWith(
            createThreadedComponentDeclaration({
              functionNode: replacement.functionNode,
              threadedComponentIdentifier,
              threadedComponentIdValue: replacement.threadedComponentIdValue,
              t,
            }),
          );
        });

        runtimeShortcutReplacements.forEach((replacement) => {
          replacement.bodyPath.replaceWithMultiple(
            createRuntimeShortcutStatements({
              callIdentifier: runtimeShortcutImports.callIdentifier,
              exportAlias: replacement.exportAlias,
              functionNode: replacement.functionNode,
              runtimeFunctionIdentifier:
                runtimeShortcutImports.runtimeFunctionIdentifier,
              runtimeFunctionIdValue: replacement.runtimeFunctionIdValue,
              runtimeName: replacement.runtimeName,
              t,
            }),
          );
        });
      },

      ExportNamedDeclaration(pathRef, state) {
        if (
          !shouldTransformFile(state.file.opts.filename, state.opts.projectRoot)
        ) {
          return;
        }

        const declaration = pathRef.node.declaration;
        if (!declaration || declaration.type !== 'VariableDeclaration') {
          return;
        }

        declaration.declarations.forEach((declarator) => {
          if (
            declarator.id.type !== 'Identifier' ||
            !isBareRuntimeFunctionCall(declarator.init)
          ) {
            return;
          }

          const id = runtimeFunctionId(
            state.file.opts.filename,
            state.opts.projectRoot,
            declarator.id.name,
          );

          declarator.init.callee = t.memberExpression(
            t.identifier('runtimeFunction'),
            t.identifier('withId'),
          );
          declarator.init.arguments.unshift(t.stringLiteral(id));
        });
      },

      CallExpression(pathRef, state) {
        if (
          !shouldTransformFile(state.file.opts.filename, state.opts.projectRoot)
        ) {
          return;
        }

        const callOnRuntimeCall = extractCallOnRuntimeCall(pathRef.node);
        if (callOnRuntimeCall) {
          pathRef.replaceWith(
            t.callExpression(
              t.memberExpression(
                callOnRuntimeCall.scheduledFunction,
                t.identifier(callOnRuntimeCall.methodName),
              ),
              [callOnRuntimeCall.runtimeArg, ...callOnRuntimeCall.args],
            ),
          );
          return;
        }

        const callee = pathRef.node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'run' ||
          callee.object.type !== 'CallExpression' ||
          callee.object.callee.type !== 'Identifier' ||
          callee.object.callee.name !== 'usingRuntime'
        ) {
          return;
        }

        const runtimeArg = callee.object.arguments[0];
        const callbackArg = pathRef.node.arguments[0];
        const runtimeCall = extractCallbackCall(callbackArg);
        if (!runtimeArg || !runtimeCall) {
          throw pathRef.buildCodeFrameError(
            'usingRuntime(...).run(...) must receive a zero-argument callback that returns one runtime function call.',
          );
        }

        pathRef.replaceWith(
          t.callExpression(
            t.memberExpression(runtimeCall.callee, t.identifier('runOn')),
            [runtimeArg, ...runtimeCall.arguments],
          ),
        );
      },
    },
  };
};
