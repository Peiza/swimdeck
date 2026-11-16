// Finds names that would fail at runtime: identifiers that are used but never
// declared, imported or known as a global, and imports of names the target
// module does not export. Run with `npm run check`.
//
// The parser is acorn; the scope analysis below is our own. References are
// resolved after a whole file has been walked, so hoisting and closures work
// without a separate pass. The temporal dead zone is not checked.
//
// A file can allow extra globals with a comment: /* global name1, name2 */

import { parse } from 'acorn';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- globals

const JS_GLOBALS = `
  globalThis undefined NaN Infinity
  Object Function Array String Number Boolean Symbol BigInt Math JSON Date RegExp
  Map Set WeakMap WeakSet WeakRef Promise Proxy Reflect Intl
  Error TypeError RangeError SyntaxError ReferenceError EvalError URIError AggregateError
  ArrayBuffer SharedArrayBuffer DataView Atomics
  Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array
  Float32Array Float64Array BigInt64Array BigUint64Array
  parseInt parseFloat isNaN isFinite
  encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape
`;

// Available in browsers, service workers and Cloudflare Workers alike.
const WEB_GLOBALS = `
  console fetch Request Response Headers URL URLSearchParams FormData Blob File
  AbortController AbortSignal Event EventTarget CustomEvent MessageChannel BroadcastChannel
  TextEncoder TextDecoder ReadableStream WritableStream TransformStream
  CompressionStream DecompressionStream
  crypto CryptoKey SubtleCrypto atob btoa structuredClone queueMicrotask
  setTimeout clearTimeout setInterval clearInterval
  performance navigator self caches WebSocket DOMException
  addEventListener removeEventListener dispatchEvent
`;

const BROWSER_GLOBALS = `
  window document location history screen localStorage sessionStorage indexedDB
  alert confirm prompt open close print focus scrollTo scrollBy
  requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback
  getComputedStyle matchMedia innerWidth innerHeight scrollX scrollY devicePixelRatio
  visualViewport CSS Notification PushManager ServiceWorkerRegistration
  Node Element HTMLElement SVGElement DocumentFragment Document Text Image Audio Option
  HTMLInputElement HTMLSelectElement HTMLTextAreaElement HTMLButtonElement HTMLAnchorElement
  HTMLFormElement HTMLDialogElement HTMLCanvasElement HTMLImageElement HTMLTemplateElement
  NodeList DOMParser XMLSerializer DOMRect Range Selection
  MutationObserver ResizeObserver IntersectionObserver
  KeyboardEvent MouseEvent PointerEvent TouchEvent InputEvent FocusEvent DragEvent
  ClipboardEvent ClipboardItem DataTransfer FileReader XMLHttpRequest Worker
  customElements
`;

// Extra names inside a service worker (web/sw.js).
const SERVICE_WORKER_GLOBALS = `
  clients registration skipWaiting importScripts location
  ExtendableEvent FetchEvent PushEvent NotificationEvent
`;

// Extra names in the Cloudflare Workers runtime.
const WORKER_GLOBALS = `
  HTMLRewriter WebSocketPair scheduler
`;

const words = (...lists) => new Set(lists.join(' ').split(/\s+/).filter(Boolean));

export const ENVIRONMENTS = {
  browser: words(JS_GLOBALS, WEB_GLOBALS, BROWSER_GLOBALS),
  serviceworker: words(JS_GLOBALS, WEB_GLOBALS, SERVICE_WORKER_GLOBALS),
  worker: words(JS_GLOBALS, WEB_GLOBALS, WORKER_GLOBALS),
};

// ---------------------------------------------------------------- parsing

const isModuleError = (e) => /import|export|module/i.test(e.message);

/** Parses as a module, or as a classic script when the file is not a module. */
function parseSource(code, comments) {
  const options = { ecmaVersion: 'latest', locations: true, onComment: comments };
  try {
    return parse(code, { ...options, sourceType: 'module' });
  } catch (moduleError) {
    if (/^\s*(import|export)\b/m.test(code) || isModuleError(moduleError)) throw moduleError;
    comments.length = 0;
    try {
      return parse(code, { ...options, sourceType: 'script' });
    } catch {
      throw moduleError;
    }
  }
}

/** Names from "global a, b" comments. */
function declaredGlobals(comments) {
  const names = [];
  for (const c of comments) {
    const m = c.type === 'Block' && /^\s*globals?\s+([\s\S]*)$/.exec(c.value);
    if (m) names.push(...m[1].split(/[\s,]+/).map((n) => n.split(':')[0]).filter(Boolean));
  }
  return names;
}

// ---------------------------------------------------------------- scopes

class Scope {
  constructor(parent, isFunction) {
    this.parent = parent;
    this.isFunction = isFunction;
    this.names = new Map();
  }

  declare(name, info = {}) {
    if (!this.names.has(name)) this.names.set(name, info);
  }

  /** The scope `var` declarations belong to. */
  varScope() {
    let s = this;
    while (!s.isFunction && s.parent) s = s.parent;
    return s;
  }

  lookup(name) {
    for (let s = this; s; s = s.parent) {
      if (s.names.has(name)) return s.names.get(name);
    }
    return null;
  }
}

/**
 * Walks one file. Returns the references (resolved by the caller once every
 * declaration is known), the imports and the exports.
 */
function analyze(ast) {
  const root = new Scope(null, true);
  const refs = [];
  const imports = [];
  const dynamicImports = [];
  const exports = { names: new Set(), stars: [] };

  const ref = (node, scope, extra) => refs.push({ name: node.name, node, scope, ...extra });

  /** Declares every name a binding pattern introduces. */
  function declarePattern(node, target, scope, info) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        target.declare(node.name, info);
        break;
      case 'ObjectPattern':
        for (const p of node.properties) {
          if (p.type === 'RestElement') declarePattern(p.argument, target, scope, info);
          else {
            if (p.computed) visit(p.key, scope);
            declarePattern(p.value, target, scope, info);
          }
        }
        break;
      case 'ArrayPattern':
        for (const el of node.elements) declarePattern(el, target, scope, info);
        break;
      case 'RestElement':
        declarePattern(node.argument, target, scope, info);
        break;
      case 'AssignmentPattern':
        declarePattern(node.left, target, scope, info);
        visit(node.right, scope);
        break;
      default:
        visit(node, scope);
    }
  }

  function visitFunction(node, scope) {
    const fn = new Scope(scope, true);
    if (node.type !== 'ArrowFunctionExpression') fn.declare('arguments');
    for (const p of node.params) declarePattern(p, fn, fn);
    if (node.body.type === 'BlockStatement') visitAll(node.body.body, fn);
    else visit(node.body, fn);
  }

  function visitClass(node, scope) {
    visit(node.superClass, scope);
    for (const member of node.body.body) {
      if (member.type === 'StaticBlock') {
        visitAll(member.body, new Scope(scope, true));
        continue;
      }
      // Member names are properties, not identifiers, unless computed.
      if (member.computed) visit(member.key, scope);
      if (member.type === 'PropertyDefinition') visit(member.value, new Scope(scope, true));
      else visit(member.value, scope);
    }
  }

  function visitAll(nodes, scope) {
    for (const n of nodes) visit(n, scope);
  }

  function visitChildren(node, scope) {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (!value || typeof value !== 'object' || key === 'loc') continue;
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item.type === 'string') visit(item, scope);
      } else if (typeof value.type === 'string') {
        visit(value, scope);
      }
    }
  }

  /** Adds the names a binding pattern introduces to `into`. */
  function patternNames(node, into) {
    if (!node) return;
    if (node.type === 'Identifier') into.add(node.name);
    else if (node.type === 'ObjectPattern') for (const p of node.properties) patternNames(p.value || p.argument, into);
    else if (node.type === 'ArrayPattern') for (const el of node.elements) patternNames(el, into);
    else if (node.type === 'RestElement') patternNames(node.argument, into);
    else if (node.type === 'AssignmentPattern') patternNames(node.left, into);
  }

  function exportedName(node) {
    return node.type === 'Identifier' ? node.name : String(node.value);
  }

  function visit(node, scope) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        ref(node, scope);
        return;

      case 'VariableDeclaration': {
        const target = node.kind === 'var' ? scope.varScope() : scope;
        for (const d of node.declarations) {
          declarePattern(d.id, target, scope);
          visit(d.init, scope);
        }
        return;
      }

      case 'FunctionDeclaration':
        if (node.id) scope.declare(node.id.name);
        visitFunction(node, scope);
        return;

      case 'FunctionExpression': {
        // A named function expression sees its own name.
        let inner = scope;
        if (node.id) {
          inner = new Scope(scope, false);
          inner.declare(node.id.name);
        }
        visitFunction(node, inner);
        return;
      }

      case 'ArrowFunctionExpression':
        visitFunction(node, scope);
        return;

      case 'ClassDeclaration':
        if (node.id) scope.declare(node.id.name);
        visitClass(node, scope);
        return;

      case 'ClassExpression': {
        let inner = scope;
        if (node.id) {
          inner = new Scope(scope, false);
          inner.declare(node.id.name);
        }
        visitClass(node, inner);
        return;
      }

      case 'BlockStatement':
        visitAll(node.body, new Scope(scope, false));
        return;

      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
        visitChildren(node, new Scope(scope, false));
        return;

      case 'SwitchStatement':
        visit(node.discriminant, scope);
        visitAll(node.cases, new Scope(scope, false));
        return;

      case 'CatchClause': {
        const inner = new Scope(scope, false);
        declarePattern(node.param, inner, inner);
        visitAll(node.body.body, inner);
        return;
      }

      case 'MemberExpression':
        if (node.object.type === 'Identifier' && !node.computed && node.property.type === 'Identifier') {
          ref(node.object, scope, { member: node.property.name });
        } else {
          visit(node.object, scope);
        }
        if (node.computed) visit(node.property, scope);
        return;

      case 'Property': // object literals and destructuring assignments
        if (node.computed) visit(node.key, scope);
        visit(node.value, scope);
        return;

      case 'UnaryExpression':
        // typeof on an undeclared name is safe at runtime.
        if (node.operator === 'typeof' && node.argument.type === 'Identifier') {
          ref(node.argument, scope, { safe: true });
        } else {
          visit(node.argument, scope);
        }
        return;

      case 'LabeledStatement': // labels are not identifiers; the parser checks them
        visit(node.body, scope);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return;

      case 'ImportDeclaration':
        for (const s of node.specifiers) {
          const imported =
            s.type === 'ImportSpecifier' ? exportedName(s.imported)
            : s.type === 'ImportDefaultSpecifier' ? 'default'
            : '*';
          root.declare(s.local.name, imported === '*' ? { namespaceOf: node.source.value } : {});
          imports.push({ source: node.source.value, imported, node: s });
        }
        if (!node.specifiers.length) imports.push({ source: node.source.value, imported: null, node });
        return;

      case 'ImportExpression':
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          dynamicImports.push({ source: node.source.value, node });
        }
        visitChildren(node, scope);
        return;

      case 'ExportNamedDeclaration':
        if (node.declaration) {
          const d = node.declaration;
          if (d.type === 'VariableDeclaration') {
            for (const decl of d.declarations) patternNames(decl.id, exports.names);
          } else if (d.id) {
            exports.names.add(d.id.name);
          }
          visit(d, scope);
          return;
        }
        for (const s of node.specifiers) {
          exports.names.add(exportedName(s.exported));
          if (node.source) {
            imports.push({ source: node.source.value, imported: exportedName(s.local), node: s });
          } else if (s.local.type === 'Identifier') {
            ref(s.local, scope);
          }
        }
        return;

      case 'ExportDefaultDeclaration':
        exports.names.add('default');
        visit(node.declaration, scope);
        return;

      case 'ExportAllDeclaration':
        if (node.exported) {
          exports.names.add(exportedName(node.exported));
          imports.push({ source: node.source.value, imported: null, node });
        } else {
          exports.stars.push(node.source.value);
          imports.push({ source: node.source.value, imported: null, node });
        }
        return;

      default:
        visitChildren(node, scope);
    }
  }

  visitAll(ast.body, root);
  return { refs, imports, dynamicImports, exports };
}

// ---------------------------------------------------------------- modules

/** './lib.js?v=3' seen from 'web/app.js' is 'web/lib.js'; null for packages. */
export function resolveImport(from, source) {
  if (!/^\.{1,2}\//.test(source)) return null;
  const clean = source.replace(/[?#].*$/, '');
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), clean));
}

/**
 * Checks a set of files.
 *
 * @param {Record<string, string>} sources file path (forward slashes) to code
 * @param {object} [options]
 * @param {(file: string) => Iterable<string>} [options.globalsFor] known globals of a file
 * @param {(file: string) => string | null} [options.read] reads a file that is
 *   imported but not in `sources`; such a file is used for its exports only
 * @returns {{ file: string, line: number, column: number, message: string }[]}
 */
export function checkSources(sources, options = {}) {
  const globalsFor = options.globalsFor || (() => ENVIRONMENTS.browser);
  const read = options.read || (() => null);
  const findings = [];
  const modules = new Map(); // file -> analysis, or null when unreadable

  const report = (file, node, message) =>
    findings.push({ file, line: node.loc.start.line, column: node.loc.start.column + 1, message });

  function load(file, checked) {
    if (modules.has(file)) return modules.get(file);
    const code = checked ? sources[file] : read(file);
    let result = null;
    if (typeof code === 'string') {
      const comments = [];
      try {
        const ast = parseSource(code, comments);
        result = { ...analyze(ast), extraGlobals: declaredGlobals(comments) };
      } catch (e) {
        result = { failed: true };
        if (checked) {
          findings.push({
            file,
            line: e.loc ? e.loc.line : 1,
            column: e.loc ? e.loc.column + 1 : 1,
            message: `cannot parse: ${e.message}`,
          });
        }
      }
    }
    modules.set(file, result);
    return result;
  }

  const loadAny = (file) => load(file, Object.hasOwn(sources, file));

  /** Every name a module exports, following `export * from`; null if unknown. */
  function exportsOf(file, seen = new Set()) {
    if (seen.has(file)) return new Set();
    seen.add(file);
    const mod = loadAny(file);
    if (!mod || mod.failed) return null;
    const names = new Set(mod.exports.names);
    for (const source of mod.exports.stars) {
      const target = resolveImport(file, source);
      const inner = target && exportsOf(target, seen);
      if (!inner) return null;
      for (const n of inner) if (n !== 'default') names.add(n);
    }
    return names;
  }

  for (const file of Object.keys(sources).sort()) {
    const mod = load(file, true);
    if (!mod || mod.failed) continue;

    // Imports.
    for (const imp of [...mod.imports, ...mod.dynamicImports]) {
      const target = resolveImport(file, imp.source);
      if (!target) continue; // a package or a built-in module
      const targetMod = loadAny(target);
      if (!targetMod) {
        report(file, imp.node, `cannot find module '${imp.source}' (${target})`);
        continue;
      }
      if (!imp.imported || imp.imported === '*') continue;
      const names = exportsOf(target);
      if (names && !names.has(imp.imported)) {
        report(file, imp.node, `'${imp.imported}' is not exported by '${imp.source}' (${target})`);
      }
    }

    // Identifiers.
    const globals = new Set([...globalsFor(file), ...mod.extraGlobals]);
    for (const r of mod.refs) {
      const binding = r.scope.lookup(r.name);
      if (!binding) {
        if (!globals.has(r.name) && !r.safe) report(file, r.node, `'${r.name}' is not defined`);
        continue;
      }
      if (binding.namespaceOf && r.member) {
        const target = resolveImport(file, binding.namespaceOf);
        const names = target && loadAny(target) ? exportsOf(target) : null;
        if (names && !names.has(r.member)) {
          report(file, r.node, `'${r.name}.${r.member}' is not exported by '${binding.namespaceOf}' (${target})`);
        }
      }
    }
  }

  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
}

// ---------------------------------------------------------------- project

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** web/*.js without the generated data files, plus worker/src/*.js. */
export function projectFiles(root = ROOT) {
  const list = (dir, keep = () => true) =>
    readdirSync(path.join(root, dir), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.js') && keep(e.name))
      .map((e) => `${dir}/${e.name}`);
  return [...list('web', (name) => !name.endsWith('-data.js')), ...list('worker/src')].sort();
}

export function environmentOf(file) {
  if (file.startsWith('worker/')) return ENVIRONMENTS.worker;
  if (file === 'web/sw.js') return ENVIRONMENTS.serviceworker;
  return ENVIRONMENTS.browser;
}

export function checkProject(root = ROOT) {
  const files = projectFiles(root);
  const sources = Object.fromEntries(files.map((f) => [f, readFileSync(path.join(root, f), 'utf8')]));
  const read = (file) => {
    const full = path.join(root, file);
    return existsSync(full) ? readFileSync(full, 'utf8') : null;
  };
  return { files, findings: checkSources(sources, { globalsFor: environmentOf, read }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, findings } = checkProject();
  for (const f of findings) console.error(`${f.file}:${f.line}:${f.column}: ${f.message}`);
  if (findings.length) {
    console.error(`\n${findings.length} problem${findings.length === 1 ? '' : 's'} in ${files.length} files.`);
    process.exit(1);
  }
  console.log(`check-names: ${files.length} files, no undeclared names or bad imports.`);
}
