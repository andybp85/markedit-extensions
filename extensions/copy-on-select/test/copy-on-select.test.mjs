import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptSrc = readFileSync(join(extensionDir, 'copy-on-select.js'), 'utf8');

// A stand-in for a CodeMirror EditorView. `ranges` is an array of [from, to]
// pairs into `doc`; a pair with from === to is an empty (cursor) range.
function viewOf(doc, ranges) {
  return {
    state: {
      selection: { ranges: ranges.map(([from, to]) => ({ empty: from === to, from, to })) },
      sliceDoc: (from, to) => doc.slice(from, to),
    },
  };
}

// Build a sandbox emulating the MarkEdit WebView, load the drop-in script, and
// return the callbacks it registered plus spies on everything it can call.
function load({ clipboardError, createFileResult = true, files = {}, userSettings = {} } = {}) {
  const calls = { alerts: [], created: [], warns: [], writeText: [] };
  const documentHandlers = {};
  const domHandlers = {};
  let menuItem = null;

  const MarkEdit = {
    addExtension: (extension) => { Object.assign(domHandlers, extension); },
    addMainMenuItem: (item) => { menuItem = item; },
    createFile: async (args) => { calls.created.push({ ...args }); return createFileResult; },
    editorView: undefined,
    getDirectoryPath: () => '/docs',
    getFileContent: async (path) => files[path],
    showAlert: (alert) => { calls.alerts.push(alert); },
    userSettings,
  };

  // domEventHandlers normally returns an opaque CodeMirror extension. Returning
  // the handler map lets a test invoke a handler directly.
  const EditorView = { domEventHandlers: (handlers) => handlers };

  const requireFn = (name) => {
    if (name === 'markedit-api') return { MarkEdit };
    if (name === '@codemirror/view') return { EditorView };
    throw new Error(`unknown module: ${name}`);
  };

  const sandbox = {
    console: { error: () => {}, warn: (...args) => { calls.warns.push(args.join(' ')); } },
    document: { addEventListener: (type, handler) => { documentHandlers[type] = handler; } },
    globalThis: undefined,
    navigator: {
      clipboard: {
        writeText: (text) => {
          calls.writeText.push(text);
          return clipboardError ? Promise.reject(clipboardError) : Promise.resolve();
        },
      },
    },
    require: requireFn,
    window: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scriptSrc, sandbox, { filename: 'copy-on-select.js' });

  return { calls, documentHandlers, domHandlers, MarkEdit, menuItem };
}

test('a mouseup with a non-empty selection copies the selected text', () => {
  const { calls, domHandlers } = load();
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  assert.deepEqual(calls.writeText, ['quick']);
});

test('a mouseup with an empty selection copies nothing', () => {
  const { calls, domHandlers } = load();
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 4]]));
  assert.deepEqual(calls.writeText, []);
});

test('a multi-range selection joins the ranges with a newline', () => {
  const { calls, domHandlers } = load();
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9], [10, 15]]));
  assert.deepEqual(calls.writeText, ['quick\nbrown']);
});

test('empty ranges are dropped from a mixed selection', () => {
  const { calls, domHandlers } = load();
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9], [10, 10]]));
  assert.deepEqual(calls.writeText, ['quick']);
});

test('the mouseup handler returns undefined so CodeMirror keeps its default behavior', () => {
  const { domHandlers } = load();
  assert.equal(domHandlers.mouseup({}, viewOf('abc', [[0, 3]])), undefined);
});

test('the same text selected twice copies one time', () => {
  const { calls, domHandlers } = load();
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  assert.deepEqual(calls.writeText, ['quick']);
});

test('a different selection after a repeat copies again', () => {
  const { calls, domHandlers } = load();
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[10, 15]]));
  assert.deepEqual(calls.writeText, ['quick', 'brown']);
});

test('identical text at a different position still counts as a repeat', () => {
  const { calls, domHandlers } = load();
  domHandlers.mouseup({}, viewOf('fox and fox', [[0, 3]]));
  domHandlers.mouseup({}, viewOf('fox and fox', [[8, 11]]));
  assert.deepEqual(calls.writeText, ['fox']);
});

test('a rejected clipboard write does not throw, and it warns', async () => {
  const { calls, domHandlers } = load({ clipboardError: new Error('denied') });
  assert.doesNotThrow(() => domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]])));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.warns.length, 1);
  assert.match(calls.warns[0], /copy-on-select/);
  assert.equal(calls.alerts.length, 0, 'a per-selection failure must not alert');
});

test('after a failed write, the same text can be copied again', async () => {
  const { calls, domHandlers } = load({ clipboardError: new Error('denied') });
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  await new Promise((resolve) => setImmediate(resolve));
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  assert.deepEqual(calls.writeText, ['quick', 'quick']);
});

test('registers a menu item with the exact title', () => {
  const { menuItem } = load();
  assert.ok(menuItem, 'a menu item should be registered');
  assert.equal(menuItem.title, 'Copy on Select');
  assert.equal(typeof menuItem.action, 'function');
  assert.equal(typeof menuItem.state, 'function');
});

test('the extension is on when the settings key is absent', () => {
  const { menuItem } = load();
  assert.equal(menuItem.state().isSelected, true);
});

test('the extension is off when the settings key says so', () => {
  const { menuItem } = load({ userSettings: { 'extension.copyOnSelect': { enabled: false } } });
  assert.equal(menuItem.state().isSelected, false);
});

test('a mouseup copies nothing while the extension is off', () => {
  const { calls, domHandlers } = load({ userSettings: { 'extension.copyOnSelect': { enabled: false } } });
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  assert.deepEqual(calls.writeText, []);
});

test('the menu item toggles the state and the copying', () => {
  const { calls, domHandlers, menuItem } = load();
  menuItem.action();
  assert.equal(menuItem.state().isSelected, false);
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  assert.deepEqual(calls.writeText, []);

  menuItem.action();
  assert.equal(menuItem.state().isSelected, true);
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  assert.deepEqual(calls.writeText, ['quick']);
});

test('turning the extension off clears the repeat record', () => {
  const { calls, domHandlers, menuItem } = load();
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  menuItem.action();
  menuItem.action();
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  assert.deepEqual(calls.writeText, ['quick', 'quick']);
});
