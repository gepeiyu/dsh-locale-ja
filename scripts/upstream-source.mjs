import ts from 'typescript';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const repository = 'https://github.com/deepseek-ai/deepseek-harness';
export const runtimePath = 'packages/client/locale/src/client/index.ts';

export function gitSource(directory, ref) {
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const files = git(['ls-tree', '-r', '--name-only', commit]).trim().split('\n');
  let registrationFiles;
  try {
    registrationFiles = git(['grep', '-l', '-I', '-F', 'register', commit, '--', 'packages']).trim()
      .split('\n').filter(Boolean).map(line => line.slice(commit.length + 1));
  } catch (error) {
    if (error.status !== 1) throw error;
    registrationFiles = [];
  }
  const cache = new Map();
  return { commit, files, registrationFiles, read: file => {
    if (!cache.has(file)) cache.set(file, git(['show', `${commit}:${file}`]));
    return cache.get(file);
  } };
}

// Read only static expressions. Never execute upstream application code.
export function extractCatalog(source) {
  const modules = new Map();
  function module(file) {
    if (modules.has(file)) return modules.get(file);
    const ast = ts.createSourceFile(file, source.read(file), ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (ast.parseDiagnostics.length) throw new Error(`${file}: TypeScript parse failed`);
    const value = { file, ast, scopes: new Map(), exports: new Map() };
    modules.set(file, value);
    const scopeOf = node => {
      while (node && !ts.isBlock(node) && !ts.isSourceFile(node) && !ts.isModuleBlock(node)
        && !ts.isFunctionLike(node) && !ts.isForStatement(node) && !ts.isForOfStatement(node)) node = node.parent;
      return node;
    };
    const bind = (scope, name, binding) => {
      if (!value.scopes.has(scope)) value.scopes.set(scope, new Map());
      const bindings = value.scopes.get(scope);
      bindings.set(name, bindings.has(name) ? { ambiguous: name } : binding);
    };
    const bindDynamic = (scope, name) => {
      if (ts.isIdentifier(name)) bind(scope, name.text, { dynamic: name.text });
      else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        for (const item of name.elements) if (ts.isBindingElement(item)) bindDynamic(scope, item.name);
      }
    };
    function visit(node) {
      if (ts.isFunctionLike(node)) for (const parameter of node.parameters) bindDynamic(node, parameter.name);
      if (ts.isVariableDeclaration(node) && (!ts.isIdentifier(node.name) || !node.initializer)) bindDynamic(scopeOf(node), node.name);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const binding = { module: value, node: node.initializer, name: node.name.text };
        bind(scopeOf(node), node.name.text, binding);
        if (node.parent.parent.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) value.exports.set(node.name.text, binding);
      }
      if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
        const names = node.importClause.namedBindings;
        if (names && ts.isNamedImports(names)) for (const item of names.elements) {
          if (!item.isTypeOnly) bind(ast, item.name.text, { request: node.moduleSpecifier.text, imported: (item.propertyName ?? item.name).text });
        }
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const item of node.exportClause.elements) if (!item.isTypeOnly) value.exports.set(item.name.text,
          node.moduleSpecifier ? { request: node.moduleSpecifier.text, imported: (item.propertyName ?? item.name).text }
            : { local: (item.propertyName ?? item.name).text });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    return value;
  }
  function imported(mod, binding) {
    if (!binding.request.startsWith('.')) throw new Error(`${mod.file}: non-relative static import ${binding.request}`);
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(mod.file), binding.request));
    const target = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`].find(file => source.files.includes(file));
    if (!target) throw new Error(`${mod.file}: missing import ${binding.request}`);
    const targetModule = module(target);
    const exported = targetModule.exports.get(binding.imported);
    if (!exported) throw new Error(`${target}: missing export ${binding.imported}`);
    return resolveBinding(targetModule, exported);
  }
  function resolveBinding(mod, binding) {
    if (binding.ambiguous) throw new Error(`${mod.file}: ambiguous static binding ${binding.ambiguous}`);
    if (binding.dynamic) throw new Error(`${mod.file}: non-static binding ${binding.dynamic}`);
    if (binding.request) return imported(mod, binding);
    if (binding.local) return lookup(mod, mod.ast, binding.local);
    return binding;
  }
  function lookup(mod, node, name) {
    for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
      const binding = mod.scopes.get(ancestor)?.get(name);
      if (binding) return resolveBinding(mod, binding);
    }
    throw new Error(`${mod.file}: unresolved static identifier ${name}`);
  }
  const resolving = new Set();
  function evaluate(mod, node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return evaluate(mod, node.expression);
    if (ts.isIdentifier(node)) {
      const binding = lookup(mod, node, node.text);
      if (resolving.has(binding.node)) throw new Error(`${mod.file}: cyclic static expression`);
      resolving.add(binding.node);
      try { return evaluate(binding.module, binding.node); } finally { resolving.delete(binding.node); }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const result = Object.create(null);
      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop)) Object.assign(result, evaluate(mod, prop.expression));
        else if (ts.isShorthandPropertyAssignment(prop)) result[prop.name.text] = evaluate(mod, prop.name);
        else if (ts.isPropertyAssignment(prop)) {
          const key = ts.isComputedPropertyName(prop.name) ? evaluate(mod, prop.name.expression) : prop.name.text;
          result[key] = evaluate(mod, prop.initializer);
        } else throw new Error(`${mod.file}: unsupported dictionary property`);
      }
      return result;
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(item => ts.isSpreadElement(item) ? evaluate(mod, item.expression) : [evaluate(mod, item)]);
    if (ts.isPropertyAccessExpression(node)) return evaluate(mod, node.expression)[node.name.text];
    if (ts.isElementAccessExpression(node)) return evaluate(mod, node.expression)[evaluate(mod, node.argumentExpression)];
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return evaluate(mod, node.left) + evaluate(mod, node.right);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
      const items = evaluate(mod, node.expression.expression);
      if (Array.isArray(items)) return items.join(node.arguments.length ? evaluate(mod, node.arguments[0]) : ',');
    }
    throw new Error(`${mod.file}:${mod.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: unsupported static expression: ${node.getText().slice(0, 100)}`);
  }
  function origin(mod, node) {
    if (ts.isIdentifier(node)) {
      const binding = lookup(mod, node, node.text);
      return { path: binding.module.file, export: binding.name };
    }
    return { path: mod.file, export: 'inline dictionaries.en' };
  }
  const catalog = Object.create(null), namespaces = Object.create(null), errors = [];
  for (const file of (source.registrationFiles ?? source.files).filter(file => /^packages\/.*\/src\//.test(file) && /\.tsx?$/.test(file) && !/(?:\/__tests__\/|\.(?:test|spec)\.tsx?$)/.test(file))) {
    // This literal prefilter only reduces parsing; registration analysis uses the AST.
    if (!source.read(file).includes('register')) continue;
    const mod = module(file);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'register') {
        const receiver = node.expression.expression;
        const isLocale = (ts.isIdentifier(receiver) && receiver.text === 'locale') || (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'locale');
        if (isLocale) try {
          const namespace = evaluate(mod, node.arguments[0]);
          if (typeof namespace !== 'string' || !/^[\w.-]+$/.test(namespace)) throw new Error(`${file}: invalid namespace`);
          let dict, descriptor;
          if (node.arguments.length === 2) {
            const dictionaries = node.arguments[1];
            if (!ts.isObjectLiteralExpression(dictionaries)) throw new Error(`${file}: unsupported register overload`);
            const english = dictionaries.properties.find(prop => prop.name?.text === 'en');
            if (!english) throw new Error(`${file}: English registration not found`);
            const expression = ts.isShorthandPropertyAssignment(english) ? english.name : english.initializer;
            dict = evaluate(mod, expression); descriptor = origin(mod, expression);
          } else if (node.arguments.length === 3) {
            const language = node.arguments[1];
            if (ts.isStringLiteral(language)) {
              if (language.text !== 'en') return;
              dict = evaluate(mod, node.arguments[2]); descriptor = origin(mod, node.arguments[2]);
            } else {
              let loop = node.parent;
              while (loop && !ts.isForOfStatement(loop)) loop = loop.parent;
              const declaration = loop && ts.isVariableDeclarationList(loop.initializer) && loop.initializer.declarations[0];
              const names = declaration && ts.isArrayBindingPattern(declaration.name) && declaration.name.elements.map(item => item.name?.text);
              if (!names || language.getText() !== names[0] || node.arguments[2].getText() !== names[1]) throw new Error(`${file}: unsupported dynamic locale registration`);
              dict = Object.fromEntries(evaluate(mod, loop.expression)).en; descriptor = { path: file, export: 'inline dictionaries.en' };
            }
          } else throw new Error(`${file}: unsupported register overload`);
          if (!dict || typeof dict !== 'object' || Array.isArray(dict) || !Object.values(dict).every(value => typeof value === 'string')) throw new Error(`${file}: invalid English dictionary`);
          if (Object.hasOwn(catalog, namespace)) throw new Error(`${file}: duplicate namespace ${namespace}`);
          catalog[namespace] = dict; namespaces[namespace] = descriptor;
        } catch (error) { errors.push(error.message); }
      }
      ts.forEachChild(node, visit);
    }
    visit(mod.ast);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  if (!Object.keys(catalog).length) throw new Error('No locale registrations found; upstream layout may have changed.');
  const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b, 'en')));
  return { catalog: sorted(catalog), namespaces: sorted(namespaces) };
}
