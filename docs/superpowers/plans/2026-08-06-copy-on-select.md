# Copy on Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `copy-on-select` MarkEdit extension that copies the selected text to the clipboard when a mouse selection ends, like the "Copy to pasteboard on selection" option of iTerm2.

**Architecture:** One drop-in script registers a CodeMirror `mouseup` DOM event handler through `MarkEdit.addExtension`, plus a backstop `mouseup` handler on `document` for drags that end outside the editor. Both handlers call one `copySelection(view)` function that applies the skip rules and writes the clipboard. A checkmark item in the Extensions menu turns the extension on and off, and writes that state to `settings.json`.

**Tech Stack:** Plain JavaScript, no build step, no dependencies. Node 20 or later for the tests, with `node:test` and `node:vm`. The MarkEdit script runtime supplies `markedit-api` and `@codemirror/view` to `require`.

**Spec:** `docs/superpowers/specs/2026-08-06-copy-on-select-design.md`

## Global Constraints

- The script is a plain drop-in file. It has no build step, no exports, and no `import` statements. Tests reach it only through the callbacks that it registers.
- House JavaScript style: no semicolons, `const` by default, arrow functions, `undefined` over `null`, object properties in alphabetical order. Match `extensions/toggle-dark/theme-toggle.js`.
- Maximum line length is 140 columns. Indent with 4 spaces in new shell files and 2 spaces in JavaScript, to match the files that are already here.
- Test files use semicolons and single quotes, to match `extensions/toggle-dark/test/`.
- The settings key is exactly `extension.copyOnSelect`. Its shape is `{ "enabled": true }`. The default is `true` when the key is absent.
- The menu title is exactly `Copy on Select`.
- Every documentation file uses Simplified Technical English: conditions before commands, one instruction per sentence, `make sure that` for the check idea.
- **Never write `settings.json` when its current content exists but does not parse.** That write would replace every MarkEdit setting of the user with one key.
- Run the whole suite with `npm test` from the root of the repository.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `extensions/copy-on-select/copy-on-select.js` | Create. The whole extension: selection reading, clipboard write, menu item, persistence, listeners. |
| `extensions/copy-on-select/test/copy-on-select.test.mjs` | Create. The `node:vm` sandbox harness and every behavior test. |
| `extensions/copy-on-select/README.md` | Create. What the extension does, how to install it, how to configure it, what it cannot do. |
| `test/repo.test.mjs` | Create. Repository invariants that every extension must satisfy. |
| `README.md` | Modify. Add a row to the table of extensions. |
| `CHANGELOG.md` | Modify. Add the `1.1.0` entry. |
| `package.json` | Modify. Set the version to `1.1.0`. |

The extension stays in one file. It is about 90 lines and every part of it turns on the same two variables of module state, so a split would trade one readable unit for three files that must be read together.

---

### Task 1: The sandbox harness and the copy itself

**Files:**

- Create: `extensions/copy-on-select/copy-on-select.js`
- Test: `extensions/copy-on-select/test/copy-on-select.test.mjs`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: the `load(options)` test helper and the `viewOf(doc, ranges)` view factory, which every later task uses. `load` returns `{ calls, documentHandlers, domHandlers, MarkEdit, menuItem }`. `domHandlers.mouseup(event, view)` is the CodeMirror handler. `calls.writeText` is an array of the strings that reached the clipboard.

**Background for the implementer:**

MarkEdit runs user scripts in a WKWebView. The script gets its API from `require('markedit-api')`, not from a global. The CodeMirror modules are available the same way, which the `markedit-vim` extension confirms.

`EditorView.domEventHandlers` takes a map of event names to handlers and returns a CodeMirror extension. A handler receives `(event, view)`. **A handler that returns `true` tells CodeMirror that the event is handled, which suppresses the default behavior.** Always let the handler return `undefined`. Use a block body, not a concise arrow body.

A CodeMirror selection is `state.selection.ranges`, an array of ranges. Each range has `from`, `to`, and `empty`. `state.sliceDoc(from, to)` returns the text. Most selections have one range. A multi-cursor selection has more, and Command-C joins them with a newline, so this extension does the same.

- [ ] **Step 1: Write the failing test file**

Create `extensions/copy-on-select/test/copy-on-select.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `npm test`

Expected: FAIL. Every test in the new file errors, because `extensions/copy-on-select/copy-on-select.js` does not exist and `readFileSync` throws `ENOENT`.

- [ ] **Step 3: Write the minimal implementation**

Create `extensions/copy-on-select/copy-on-select.js`:

```javascript
/*
 * MarkEdit Copy on Select
 * Copies the selected text to the clipboard when a mouse selection ends.
 * Drop this file into MarkEdit's `scripts/` directory.
 *
 * API: https://github.com/MarkEdit-app/MarkEdit/wiki/Customization#markedit-api
 */
(() => {
  'use strict'

  // In MarkEdit's scripts/ runtime the API and the CodeMirror modules are
  // CommonJS modules, not globals.
  const { MarkEdit } = require('markedit-api')
  const { EditorView } = require('@codemirror/view')

  // Join every non-empty range, the way Command-C does for a multi-cursor
  // selection, so the extension and the key produce the same text.
  const selectedText = state => state.selection.ranges
    .filter(range => !range.empty)
    .map(range => state.sliceDoc(range.from, range.to))
    .join('\n')

  const copySelection = view => {
    if (!view) return
    const text = selectedText(view.state)
    if (text === '') return
    navigator.clipboard.writeText(text)
  }

  MarkEdit.addExtension(EditorView.domEventHandlers({
    // A handler that returns true suppresses CodeMirror's own handling, so this
    // uses a block body and returns undefined.
    mouseup: (event, view) => { copySelection(view) }
  }))
})()
```

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `npm test`

Expected: PASS. 19 tests in total: 14 that were already here, and 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add extensions/copy-on-select
git commit -m "feat(copy-on-select): copy the selection when a mouse selection ends"
```

---

### Task 2: Skip repeats, and survive a clipboard failure

**Files:**

- Modify: `extensions/copy-on-select/copy-on-select.js`
- Test: `extensions/copy-on-select/test/copy-on-select.test.mjs`

**Interfaces:**

- Consumes: `load`, `viewOf`, and `copySelection` from Task 1.
- Produces: the `lastCopied` skip rule, which Task 5 depends on to make the two overlapping handlers safe. Adds the `clipboardError` option to `load`, which Task 1 already accepts.

**Background for the implementer:**

The extension records the copied text **before** the write, not after. `navigator.clipboard.writeText` is asynchronous. Task 5 adds a second handler that can fire for the same gesture. If the record happened after the write resolved, both handlers would see the old value and both would write. Recording first is what makes the overlap harmless.

A failed write clears the record, so that selecting the same text again can retry.

An alert is wrong for a clipboard failure. This code path can run on every selection, so an alert would make the editor unusable. Warn to the console instead.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/copy-on-select/test/copy-on-select.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `npm test`

Expected: FAIL. "the same text selected twice copies one time" gets `['quick', 'quick']`. "a rejected clipboard write does not throw" fails on an unhandled promise rejection, because nothing catches it yet.

- [ ] **Step 3: Write the minimal implementation**

In `extensions/copy-on-select/copy-on-select.js`, add the module state after the `require` lines:

```javascript
  // The text of the last write. A repeat of it is skipped, which stops a
  // clipboard manager from filling with identical entries, and which makes the
  // two mouseup handlers below safe to overlap.
  let lastCopied = ''
```

Then replace `copySelection` with:

```javascript
  const copySelection = view => {
    if (!view) return
    const text = selectedText(view.state)
    if (text === '' || text === lastCopied) return

    // Record before the write, not after. The write is asynchronous, so both
    // handlers could otherwise pass this test for one gesture and write twice.
    lastCopied = text
    navigator.clipboard.writeText(text).catch(error => {
      lastCopied = ''
      // This can run for every selection, so an alert here would be unusable.
      console.warn('copy-on-select: could not write to the clipboard.', error)
    })
  }
```

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `npm test`

Expected: PASS. 24 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/copy-on-select
git commit -m "feat(copy-on-select): skip repeated text and survive a clipboard failure"
```

---

### Task 3: The menu toggle and the enabled gate

**Files:**

- Modify: `extensions/copy-on-select/copy-on-select.js`
- Test: `extensions/copy-on-select/test/copy-on-select.test.mjs`

**Interfaces:**

- Consumes: `load`, `viewOf`, `copySelection` from Task 1 and Task 2.
- Produces: `menuItem`, an object with `action()`, `state()`, and `title`. `menuItem.state()` returns `{ isSelected: enabled }`. Task 4 attaches the write of `settings.json` to `menuItem.action()`.

**Background for the implementer:**

`MarkEdit.addMainMenuItem` puts an item in the Extensions menu. The `state` callback returns `{ isSelected }`, and MarkEdit draws a checkmark when `isSelected` is true. The `extensions/toggle-dark/theme-toggle.js` file uses the same shape.

`MarkEdit.userSettings` holds the parsed content of `settings.json` as MarkEdit read it at launch. The extension reads its key one time, at load.

Turning the extension off clears `lastCopied`. Without that, turning it off, copying something else with Command-C, and turning it back on could skip the first selection.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/copy-on-select/test/copy-on-select.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `npm test`

Expected: FAIL. "registers a menu item with the exact title" fails on `assert.ok(menuItem)`, because the script registers no menu item yet.

- [ ] **Step 3: Write the minimal implementation**

In `extensions/copy-on-select/copy-on-select.js`, add the constants and the state after the `require` lines:

```javascript
  const MENU_TITLE = 'Copy on Select'
  const SETTINGS_KEY = 'extension.copyOnSelect'

  let enabled = MarkEdit.userSettings?.[SETTINGS_KEY]?.enabled ?? true
```

Add the `enabled` test at the top of `copySelection`:

```javascript
  const copySelection = view => {
    if (!enabled || !view) return
```

Add the toggle and the menu item before the `MarkEdit.addExtension` call:

```javascript
  const toggle = () => {
    enabled = !enabled
    // Forget the last write, so the first selection after a restart of the
    // extension always reaches the clipboard.
    lastCopied = ''
  }

  MarkEdit.addMainMenuItem({
    action: toggle,
    state: () => ({ isSelected: enabled }),
    title: MENU_TITLE
  })
```

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `npm test`

Expected: PASS. 30 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/copy-on-select
git commit -m "feat(copy-on-select): add a menu toggle that gates the copying"
```

---

### Task 4: Remember the toggle in settings.json

**Files:**

- Modify: `extensions/copy-on-select/copy-on-select.js`
- Test: `extensions/copy-on-select/test/copy-on-select.test.mjs`

**Interfaces:**

- Consumes: `toggle` and `SETTINGS_KEY` from Task 3, and the `createFileResult` and `files` options of `load` from Task 1.
- Produces: nothing that a later task consumes.

**Background for the implementer:**

The file APIs are asynchronous. `MarkEdit.getDirectoryPath('documents')` returns the path of the MarkEdit `Documents` directory. `MarkEdit.getFileContent(path)` returns a string, or a value that is not a string when the file is absent. `MarkEdit.createFile({ overwrites: true, path, string })` returns a truthy value on success. The `markedit-direct-preview` extension uses the same three calls.

**CAUTION: Do not write the file when its content exists but does not parse.** A read-modify-write that treats unparseable content as an empty object replaces every MarkEdit setting of the user with one key. An absent or empty file is different: there is nothing to lose, so the extension writes a new file.

`JSON.parse` accepts `null`, `[]`, and `"text"`. Only a plain object is usable here. Treat everything else as a parse failure.

One alert for each session is enough. A user who toggles the item five times against a broken file does not need five alerts.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/copy-on-select/test/copy-on-select.test.mjs`:

```javascript
// The toggle writes the file in a promise that the caller does not await.
const settled = () => new Promise((resolve) => setImmediate(resolve));

test('a toggle writes settings.json and keeps the unrelated keys', async () => {
  const files = { '/docs/settings.json': JSON.stringify({ 'editor.fontSize': 14, 'extension.themeToggle': { dark: 'x' } }) };
  const { calls, menuItem } = load({ files });
  menuItem.action();
  await settled();

  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].path, '/docs/settings.json');
  assert.equal(calls.created[0].overwrites, true);
  const written = JSON.parse(calls.created[0].string);
  assert.deepEqual(written['extension.copyOnSelect'], { enabled: false });
  assert.equal(written['editor.fontSize'], 14);
  assert.deepEqual(written['extension.themeToggle'], { dark: 'x' });
});

test('a toggle keeps the unrelated keys inside its own settings object', async () => {
  const files = { '/docs/settings.json': JSON.stringify({ 'extension.copyOnSelect': { enabled: true, note: 'keep me' } }) };
  const { calls, menuItem } = load({ files });
  menuItem.action();
  await settled();
  assert.deepEqual(JSON.parse(calls.created[0].string)['extension.copyOnSelect'], { enabled: false, note: 'keep me' });
});

test('an absent settings.json is written as a new file', async () => {
  const { calls, menuItem } = load();
  menuItem.action();
  await settled();
  assert.equal(calls.created.length, 1);
  assert.deepEqual(JSON.parse(calls.created[0].string), { 'extension.copyOnSelect': { enabled: false } });
});

test('a malformed settings.json alerts and writes nothing', async () => {
  const { calls, menuItem } = load({ files: { '/docs/settings.json': '{ this is not json' } });
  menuItem.action();
  await settled();
  assert.deepEqual(calls.created, [], 'an unparseable file must never be overwritten');
  assert.equal(calls.alerts.length, 1);
  assert.match(calls.alerts[0].message, /settings\.json/);
});

test('a settings.json holding a non-object alerts and writes nothing', async () => {
  const { calls, menuItem } = load({ files: { '/docs/settings.json': '[1, 2, 3]' } });
  menuItem.action();
  await settled();
  assert.deepEqual(calls.created, []);
  assert.equal(calls.alerts.length, 1);
});

test('a failed write alerts', async () => {
  const { calls, menuItem } = load({ createFileResult: false });
  menuItem.action();
  await settled();
  assert.equal(calls.alerts.length, 1);
});

test('a broken settings.json alerts one time for each session', async () => {
  const { calls, menuItem } = load({ files: { '/docs/settings.json': '{ nope' } });
  menuItem.action();
  await settled();
  menuItem.action();
  await settled();
  assert.equal(calls.alerts.length, 1);
});

test('the toggle still works in memory when the file cannot be written', async () => {
  const { calls, domHandlers, menuItem } = load({ createFileResult: false });
  menuItem.action();
  await settled();
  assert.equal(menuItem.state().isSelected, false);
  domHandlers.mouseup({}, viewOf('the quick brown fox', [[4, 9]]));
  assert.deepEqual(calls.writeText, []);
});
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `npm test`

Expected: FAIL. "a toggle writes settings.json and keeps the unrelated keys" fails on `assert.equal(calls.created.length, 1)` with `0`, because the toggle writes nothing yet.

- [ ] **Step 3: Write the minimal implementation**

In `extensions/copy-on-select/copy-on-select.js`, add a constant next to `SETTINGS_KEY`:

```javascript
  const SETTINGS_FILE = 'settings.json'
```

Add the alert state next to `enabled`:

```javascript
  // One alert for each session. A user who toggles the item against a broken
  // file does not need one alert for each attempt.
  let alerted = false
```

Add these functions before `toggle`:

```javascript
  // typeof null is 'object', so the null test is not redundant. JSON.parse is
  // what produces null here; the rest of the file uses undefined.
  const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

  const alertOnce = message => {
    if (alerted) return
    alerted = true
    MarkEdit.showAlert({ message, title: MENU_TITLE })
  }

  // Read, merge one key, write back, so every unrelated setting survives.
  const persistEnabled = async () => {
    const path = `${MarkEdit.getDirectoryPath('documents')}/${SETTINGS_FILE}`
    const raw = await MarkEdit.getFileContent(path)

    let settings = {}
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        settings = JSON.parse(raw)
      } catch {
        settings = undefined
      }
      if (!isPlainObject(settings)) {
        // Writing now would replace every MarkEdit setting with this one key.
        alertOnce(`${SETTINGS_FILE} could not be read, so the setting was not saved. Correct the file, or the toggle will reset when you quit MarkEdit.`)
        return
      }
    }

    const current = isPlainObject(settings[SETTINGS_KEY]) ? settings[SETTINGS_KEY] : {}
    settings[SETTINGS_KEY] = { ...current, enabled }

    const written = await MarkEdit.createFile({ overwrites: true, path, string: JSON.stringify(settings, null, 2) })
    if (!written)
      alertOnce(`${SETTINGS_FILE} could not be written, so the setting was not saved. The toggle will reset when you quit MarkEdit.`)
  }
```

Then add the call to `toggle`:

```javascript
  const toggle = () => {
    enabled = !enabled
    // Forget the last write, so the first selection after a restart of the
    // extension always reaches the clipboard.
    lastCopied = ''
    void persistEnabled()
  }
```

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `npm test`

Expected: PASS. 38 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/copy-on-select
git commit -m "feat(copy-on-select): remember the toggle in settings.json"
```

---

### Task 5: The backstop handler for drags that leave the editor

**Files:**

- Modify: `extensions/copy-on-select/copy-on-select.js`
- Test: `extensions/copy-on-select/test/copy-on-select.test.mjs`

**Interfaces:**

- Consumes: `copySelection` from Task 2, and the `documentHandlers` value of `load` from Task 1.
- Produces: nothing that a later task consumes.

**Background for the implementer:**

A drag that ends outside the editor element never fires `mouseup` on it. Try to select the last line and release the button over the toolbar: the copy would not occur. A handler on `document` catches that.

This handler is not a CodeMirror handler, so nothing gives it a view. It reads `MarkEdit.editorView`, which the MarkEdit API exposes. That value can be absent before the editor is ready, so the handler must tolerate it. `copySelection` already returns for a view that is absent, so pass the value straight through.

Both handlers run for a drag that ends inside the editor. The skip rule from Task 2 makes the second call a no-op.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/copy-on-select/test/copy-on-select.test.mjs`:

```javascript
test('a mouseup on the document copies through MarkEdit.editorView', () => {
  const { calls, documentHandlers, MarkEdit } = load();
  MarkEdit.editorView = viewOf('the quick brown fox', [[4, 9]]);
  documentHandlers.mouseup({});
  assert.deepEqual(calls.writeText, ['quick']);
});

test('a mouseup on the document does nothing when the editor view is absent', () => {
  const { calls, documentHandlers } = load();
  assert.doesNotThrow(() => documentHandlers.mouseup({}));
  assert.deepEqual(calls.writeText, []);
});

test('both handlers running for one gesture copies one time', () => {
  const { calls, documentHandlers, domHandlers, MarkEdit } = load();
  const view = viewOf('the quick brown fox', [[4, 9]]);
  MarkEdit.editorView = view;
  domHandlers.mouseup({}, view);
  documentHandlers.mouseup({});
  assert.deepEqual(calls.writeText, ['quick']);
});

test('the backstop obeys the off state', () => {
  const { calls, documentHandlers, MarkEdit } = load({ userSettings: { 'extension.copyOnSelect': { enabled: false } } });
  MarkEdit.editorView = viewOf('the quick brown fox', [[4, 9]]);
  documentHandlers.mouseup({});
  assert.deepEqual(calls.writeText, []);
});
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `npm test`

Expected: FAIL. "a mouseup on the document copies through MarkEdit.editorView" throws `TypeError: documentHandlers.mouseup is not a function`, because the script registers no handler on `document` yet.

- [ ] **Step 3: Write the minimal implementation**

In `extensions/copy-on-select/copy-on-select.js`, add this after the `MarkEdit.addExtension` call:

```javascript
  // A drag that ends outside the editor never reaches the handler above. This
  // one catches it. Both can run for one gesture, which the skip rule in
  // copySelection makes harmless.
  document.addEventListener('mouseup', () => copySelection(MarkEdit.editorView))
```

- [ ] **Step 4: Run the tests to verify that they pass**

Run: `npm test`

Expected: PASS. 42 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/copy-on-select
git commit -m "feat(copy-on-select): catch drags that end outside the editor"
```

---

### Task 6: Documentation, repository invariants, and the version

**Files:**

- Create: `extensions/copy-on-select/README.md`
- Create: `test/repo.test.mjs`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: the finished extension from Tasks 1 to 5.
- Produces: nothing.

**Background for the implementer:**

The root `README.md` holds a table of extensions and a numbered list under "Add an extension" that tells a contributor to add a row to it. Nothing enforces that today. This task adds a test for the rule, so the next extension cannot arrive undocumented.

A new extension is a backward compatible addition, so the minor version increases: `1.0.0` becomes `1.1.0`.

Write every documentation file in Simplified Technical English. Put a condition before its command. Write one instruction for each sentence.

- [ ] **Step 1: Write the failing repository test**

Create `test/repo.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = join(repoDir, 'extensions');

const extensionNames = () =>
  readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

test('every extension has a README, a script, and tests', () => {
  for (const name of extensionNames()) {
    const dir = join(extensionsDir, name);
    assert.ok(existsSync(join(dir, 'README.md')), `${name} should have a README.md`);
    assert.ok(
      readdirSync(dir).some((file) => file.endsWith('.js')),
      `${name} should have a top-level .js script`
    );
    assert.ok(statSync(join(dir, 'test')).isDirectory(), `${name} should have a test directory`);
  }
});

test('the root README lists every extension', () => {
  const readme = readFileSync(join(repoDir, 'README.md'), 'utf8');
  for (const name of extensionNames())
    assert.ok(readme.includes(`extensions/${name}/`), `the README table should link extensions/${name}/`);
});

test('the changelog documents the current version', () => {
  const { version } = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
  const changelog = readFileSync(join(repoDir, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes(`## [${version}]`), `CHANGELOG.md should hold a [${version}] heading`);
});
```

- [ ] **Step 2: Run the tests to verify that they fail**

Run: `npm test`

Expected: FAIL. "every extension has a README" fails, because `extensions/copy-on-select/README.md` does not exist. "the root README lists every extension" fails on `extensions/copy-on-select/`.

- [ ] **Step 3: Write the extension README**

Create `extensions/copy-on-select/README.md`. The outer fence below is four
backticks, because the file content holds its own fenced blocks:

````markdown
# copy-on-select

A MarkEdit user script that copies the selected text to the clipboard when a mouse selection ends. This is the behavior of the
"Copy to pasteboard on selection" option of iTerm2. No keystroke is necessary.

## Install

From the root of the repository:

```bash
./install.sh copy-on-select
```

This copies `copy-on-select.js` into the MarkEdit sandbox at `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/`.
Restart MarkEdit.

## Use

Select text with the mouse. The text goes to the clipboard when you release the button. Three gestures copy:

- A click and drag across a range.
- A double-click, which selects a word.
- A triple-click, which selects a line.

To turn the extension on and off, use **Extensions → Copy on Select** in the menu bar. The item shows a checkmark when the
extension is on. The state is written to `settings.json`, so it survives a restart.

The extension is on after you install it.

## What does not copy

Keyboard selections never copy. In an editor you make keyboard selections constantly, with Shift-Arrow and its variants. If
those selections wrote to the clipboard, an edit would destroy the text that you copied with Command-C.

The extension also skips a selection when its text is the same as the text that it wrote last. This stops a flood of identical
entries in a clipboard manager.

## Configure

The extension writes this key when you use the menu item. To set the start state yourself, put it in `settings.json`:

```json
{
  "extension.copyOnSelect": { "enabled": true }
}
```

## Limits

macOS gives a user script only the general pasteboard. There is no equivalent of the X11 primary selection. Every mouse
selection therefore replaces the text that you last copied with Command-C. This is also the behavior of iTerm2. If that gets in
the way, turn the extension off from the menu.

The extension covers the editor only. A user script cannot reach the Markdown preview pane.

## Uninstall

1. Delete `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/copy-on-select.js`.
2. Remove the `extension.copyOnSelect` key from `settings.json`.
3. Restart MarkEdit.

## Develop

Run the tests from the root of the repository:

```bash
npm test
```

The tests load the drop-in script in a `node:vm` sandbox. The sandbox stubs `markedit-api`, `@codemirror/view`, `document`, and
`navigator.clipboard`, then calls the handlers that the script registers.
````

- [ ] **Step 4: Add the row to the root README**

In `README.md`, add this row to the table of extensions, under the `toggle-dark` row:

```markdown
| [copy-on-select](extensions/copy-on-select/) | Copies the selected text to the clipboard when a mouse selection ends, like iTerm2. |
```

- [ ] **Step 5: Set the version and write the changelog**

In `package.json`, change `"version": "1.0.0"` to `"version": "1.1.0"`.

In `CHANGELOG.md`, replace the `## [Unreleased]` line with:

```markdown
## [Unreleased]

## [1.1.0] - 2026-08-06

### Added

- `extensions/copy-on-select`: copies the selected text to the clipboard when a
  mouse selection ends. Keyboard selections never copy. A menu item turns the
  extension on and off, and the state is kept in the `extension.copyOnSelect`
  key of `settings.json`.
- `test/repo.test.mjs` holds the repository invariants. Every extension must
  have a README, a top-level script, and a test directory. The root README must
  list every extension, and the changelog must document the version in
  `package.json`.
```

- [ ] **Step 6: Run the tests to verify that they pass**

Run: `npm test`

Expected: PASS. 45 tests.

- [ ] **Step 7: Install it and try it by hand**

Run: `./install.sh copy-on-select`

Then restart MarkEdit and make sure that:

1. A double-click on a word puts that word on the clipboard.
2. **Extensions → Copy on Select** shows a checkmark.
3. The checkmark disappears when you use the item, and selections stop copying.
4. The state is the same after you quit MarkEdit and start it again.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: document copy-on-select and enforce the repository invariants"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task:

| Spec requirement | Task |
| --- | --- |
| Copy on `mouseup`, all three mouse gestures | 1 |
| Keyboard selections never copy | 1, by construction: only `mouseup` is bound |
| Join non-empty ranges with a newline | 1 |
| Skip repeated text | 2 |
| Record before the write | 2 |
| Clipboard failure warns and does not alert | 2 |
| Menu item with a checkmark | 3 |
| Default to on when the key is absent | 3 |
| Off state gates the copying | 3, 5 |
| Read-modify-write of `settings.json` | 4 |
| Never write an unparseable file | 4 |
| One alert for each session | 4 |
| The backstop on `document` | 5 |
| The backstop reads `MarkEdit.editorView` and tolerates its absence | 5 |
| README, root README row, changelog, version | 6 |

The plan runs 45 tests against the 12 cases that the spec names. The extra cases
cover the empty-range mix, the return value of the CodeMirror handler, retry
after a failed clipboard write, repeated text at a different position, the
merge that keeps unrelated keys inside the extension object, a settings file
holding a non-object, and the repository invariants.

**Placeholders.** None. Every step holds the code that it needs.

**Type consistency.** `copySelection(view)`, `selectedText(state)`,
`persistEnabled()`, `alertOnce(message)`, `isPlainObject(value)`, and `toggle()`
keep their names and their parameters across Tasks 1 to 5. `load` returns the
same five keys in every task. `SETTINGS_KEY` is `extension.copyOnSelect` and
`MENU_TITLE` is `Copy on Select` everywhere, and both match the README and the
changelog in Task 6.
