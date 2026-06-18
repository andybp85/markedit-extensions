# MarkEdit Light/Dark Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a MarkEdit user-script plugin whose toolbar button swaps the editor between the user's configured light and dark themes, live.

**Architecture:** A single hand-written drop-in script (`scripts/theme-toggle.js`) registers an Extensions main-menu item via the public MarkEdit-api (`addMainMenuItem`); a `settings.json` toolbar item dispatches that menu item by name. The toggle reads the current theme from `MarkEdit.editorConfig.theme`, reads configured names from `MarkEdit.userSettings`, and swaps live through the internal `window.webModules.config.setTheme({ name })` bridge. Tests load the drop-in script inside a `node:vm` sandbox with stubbed `MarkEdit`/`window` globals, so the script stays a pure drop-in (no build, no exports) while behavior is still unit-tested.

**Tech Stack:** Plain ES5-compatible JavaScript (runs in MarkEdit's WebView). Node's built-in `node:test`, `node:assert`, and `node:vm` for tests. Bash for install tooling. No third-party dependencies, no build step.

## Global Constraints

- Plugin is a single drop-in `.js` file; no build step, no bundler, no npm runtime dependencies.
- Script must reference only globals available in the MarkEdit WebView: `MarkEdit` (public api) and `window` (for `window.webModules`). It must NOT use `module.exports`, `require`, `import`, or Node-only globals.
- Script must not throw when `window.webModules` (or `.config`/`.setTheme`) is absent — guarded path shows `MarkEdit.showAlert` and returns.
- Default theme names when unset/partial: `light = "github-light"`, `dark = "github-dark"`.
- Config source: `MarkEdit.userSettings["extension.themeToggle"]`, shape `{ "light": string, "dark": string }`.
- Menu item title (the exact string the toolbar `menuName` must match): `"Toggle Light/Dark Theme"`.
- Toolbar item: `{ "title": "Toggle Theme", "icon": "circle.lefthalf.filled", "menuName": "Toggle Light/Dark Theme" }`. `icon` must be a valid SF Symbol name.
- Sandbox container documents path: `~/Library/Containers/app.cyan.markedit/Data/Documents`; scripts live in its `scripts/` subdirectory.
- `install.sh` honors a `MARKEDIT_DOCS` environment override for its target documents directory (defaults to the container path), so it is testable against a temp dir.
- Bean to update on completion: `markedit-toggle-dark-hp8s`.

---

### Task 1: Plugin script (`scripts/theme-toggle.js`) with tests

**Files:**
- Create: `scripts/theme-toggle.js`
- Test: `test/theme-toggle.test.mjs`

**Interfaces:**
- Consumes (from the MarkEdit WebView runtime): `MarkEdit.userSettings`, `MarkEdit.editorConfig.theme`, `MarkEdit.addMainMenuItem(item)`, `MarkEdit.showAlert(alert)`, `window.webModules.config.setTheme({ name })`.
- Produces: a registered main-menu item object `{ title: "Toggle Light/Dark Theme", action: () => void, state: () => ({ isSelected: boolean }) }`. The test captures this object through the `addMainMenuItem` stub and exercises `action()`/`state()`.

- [ ] **Step 1: Write the failing test**

Create `test/theme-toggle.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const scriptSrc = readFileSync(join(here, '..', 'scripts', 'theme-toggle.js'), 'utf8');

// Build a sandbox emulating the MarkEdit WebView, load the drop-in script,
// and return the captured menu item plus spies.
function load({ userSettings = {}, theme = 'github-light', webModules = 'default' } = {}) {
  const calls = { setTheme: [], alerts: [] };
  let menuItem = null;

  const setThemeFn = (arg) => { calls.setTheme.push(arg); };
  const win = {};
  if (webModules === 'default') {
    win.webModules = { config: { setTheme: setThemeFn } };
  } else if (webModules === 'missing') {
    win.webModules = undefined;
  } else {
    win.webModules = webModules; // caller-supplied shape
  }

  const MarkEdit = {
    userSettings,
    editorConfig: { theme },
    addMainMenuItem: (item) => { menuItem = item; },
    showAlert: (alert) => { calls.alerts.push(alert); },
  };

  const sandbox = { MarkEdit, window: win, globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scriptSrc, sandbox, { filename: 'theme-toggle.js' });

  return { menuItem, calls, MarkEdit };
}

test('registers the menu item with the exact title', () => {
  const { menuItem } = load();
  assert.ok(menuItem, 'a menu item should be registered');
  assert.equal(menuItem.title, 'Toggle Light/Dark Theme');
  assert.equal(typeof menuItem.action, 'function');
  assert.equal(typeof menuItem.state, 'function');
});

test('from a light theme, toggling switches to the configured dark theme', () => {
  const { menuItem, calls } = load({ theme: 'github-light' });
  menuItem.action();
  assert.deepEqual(calls.setTheme, [{ name: 'github-dark' }]);
});

test('from the dark theme, toggling switches back to the configured light theme', () => {
  const { menuItem, calls } = load({ theme: 'github-dark' });
  menuItem.action();
  assert.deepEqual(calls.setTheme, [{ name: 'github-light' }]);
});

test('honors custom light/dark names from userSettings', () => {
  const { menuItem, calls } = load({
    userSettings: { 'extension.themeToggle': { light: 'solarized-light', dark: 'solarized-dark' } },
    theme: 'solarized-light',
  });
  menuItem.action();
  assert.deepEqual(calls.setTheme, [{ name: 'solarized-dark' }]);
});

test('state reflects dark after toggling, even if editorConfig.theme does not update', () => {
  const { menuItem } = load({ theme: 'github-light' });
  assert.equal(menuItem.state().isSelected, false);
  menuItem.action(); // -> dark
  assert.equal(menuItem.state().isSelected, true);
  menuItem.action(); // -> light
  assert.equal(menuItem.state().isSelected, false);
});

test('guards when window.webModules is missing: alerts, no throw, no setTheme', () => {
  const { menuItem, calls } = load({ webModules: 'missing' });
  assert.doesNotThrow(() => menuItem.action());
  assert.equal(calls.setTheme.length, 0);
  assert.equal(calls.alerts.length, 1);
});

test('does not throw at load time when webModules is missing', () => {
  assert.doesNotThrow(() => load({ webModules: 'missing' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/theme-toggle.test.mjs`
Expected: FAIL — the script file does not exist yet (`ENOENT` reading `scripts/theme-toggle.js`).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/theme-toggle.js`:

```javascript
/*
 * MarkEdit Theme Toggle
 * Swaps the editor between the configured light and dark themes.
 * Drop this file into MarkEdit's `scripts/` directory.
 *
 * API: https://github.com/MarkEdit-app/MarkEdit/wiki/Customization#markedit-api
 */
(function () {
  "use strict";

  var MENU_TITLE = "Toggle Light/Dark Theme";
  var DEFAULTS = { light: "github-light", dark: "github-dark" };

  function config() {
    var settings = (MarkEdit.userSettings && MarkEdit.userSettings["extension.themeToggle"]) || {};
    return {
      light: settings.light || DEFAULTS.light,
      dark: settings.dark || DEFAULTS.dark
    };
  }

  // Track the active theme internally so the menu checkmark stays correct
  // regardless of whether MarkEdit writes the new name back to editorConfig.
  var activeName = (MarkEdit.editorConfig && MarkEdit.editorConfig.theme) || DEFAULTS.light;

  function isDark() {
    return activeName === config().dark;
  }

  function applyTheme(name) {
    var bridge = window.webModules && window.webModules.config;
    if (!bridge || typeof bridge.setTheme !== "function") {
      MarkEdit.showAlert({
        title: "Theme Toggle unavailable",
        message: "This MarkEdit version does not expose the theme bridge used by the toggle."
      });
      return;
    }
    bridge.setTheme({ name: name });
    activeName = name;
  }

  function toggle() {
    var names = config();
    applyTheme(isDark() ? names.light : names.dark);
  }

  MarkEdit.addMainMenuItem({
    title: MENU_TITLE,
    action: toggle,
    state: function () { return { isSelected: isDark() }; }
  });
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/theme-toggle.test.mjs`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/theme-toggle.js test/theme-toggle.test.mjs
git commit -m "feat: add theme-toggle drop-in script with vm-sandboxed tests"
```

---

### Task 2: Install tooling and settings snippet

**Files:**
- Create: `settings.snippet.json`
- Create: `install.sh`
- Test: `test/install.test.mjs`

**Interfaces:**
- Consumes: `scripts/theme-toggle.js` (from Task 1).
- Produces: `install.sh` copies `scripts/theme-toggle.js` into `"$MARKEDIT_DOCS/scripts/"` (default `MARKEDIT_DOCS=~/Library/Containers/app.cyan.markedit/Data/Documents`), creating the `scripts/` dir if needed, and prints the settings-merge instructions. Exit 0 on success.

- [ ] **Step 1: Write the failing test**

Create `test/install.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

test('settings.snippet.json is valid JSON with the toolbar item', () => {
  const snippet = JSON.parse(readFileSync(join(repo, 'settings.snippet.json'), 'utf8'));
  const items = snippet['editor.customToolbarItems'];
  assert.ok(Array.isArray(items) && items.length === 1);
  assert.equal(items[0].menuName, 'Toggle Light/Dark Theme');
  assert.equal(items[0].title, 'Toggle Theme');
  assert.equal(typeof items[0].icon, 'string');
  assert.ok(items[0].icon.length > 0);
});

test('install.sh copies the script into $MARKEDIT_DOCS/scripts and exits 0', () => {
  const docs = mkdtempSync(join(tmpdir(), 'me-docs-'));
  try {
    const out = execFileSync('bash', [join(repo, 'install.sh')], {
      env: { ...process.env, MARKEDIT_DOCS: docs },
      encoding: 'utf8'
    });
    assert.ok(existsSync(join(docs, 'scripts', 'theme-toggle.js')), 'script should be installed');
    const installed = readFileSync(join(docs, 'scripts', 'theme-toggle.js'), 'utf8');
    const source = readFileSync(join(repo, 'scripts', 'theme-toggle.js'), 'utf8');
    assert.equal(installed, source);
    assert.match(out, /customToolbarItems/); // prints settings guidance
  } finally {
    rmSync(docs, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/install.test.mjs`
Expected: FAIL — `settings.snippet.json` and `install.sh` do not exist yet.

- [ ] **Step 3: Write the settings snippet**

Create `settings.snippet.json`:

```json
{
  "editor.customToolbarItems": [
    {
      "title": "Toggle Theme",
      "icon": "circle.lefthalf.filled",
      "menuName": "Toggle Light/Dark Theme"
    }
  ]
}
```

- [ ] **Step 4: Write the installer**

Create `install.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKEDIT_DOCS="${MARKEDIT_DOCS:-$HOME/Library/Containers/app.cyan.markedit/Data/Documents}"
SCRIPTS_DIR="$MARKEDIT_DOCS/scripts"

mkdir -p "$SCRIPTS_DIR"
cp "$SRC_DIR/scripts/theme-toggle.js" "$SCRIPTS_DIR/theme-toggle.js"
echo "Installed theme-toggle.js -> $SCRIPTS_DIR/theme-toggle.js"

echo ""
echo "Next, add the toolbar button. Merge settings.snippet.json into:"
echo "  $MARKEDIT_DOCS/settings.json"
echo "specifically the \"editor.customToolbarItems\" array (see settings.snippet.json)."
echo "Then restart MarkEdit. Optionally set your theme names in settings.json:"
echo '  "extension.themeToggle": { "light": "github-light", "dark": "github-dark" }'
```

- [ ] **Step 5: Make the installer executable**

Run: `chmod +x install.sh`

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/install.test.mjs`
Expected: PASS — both tests pass.

- [ ] **Step 7: Commit**

```bash
git add settings.snippet.json install.sh test/install.test.mjs
git commit -m "feat: add settings snippet and idempotent installer with tests"
```

---

### Task 3: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: all prior deliverables (script, snippet, installer).
- Produces: user-facing documentation. No automated test; verified by the self-review checklist below.

- [ ] **Step 1: Write the README**

Create `README.md`:

```markdown
# MarkEdit Theme Toggle

A [MarkEdit](https://github.com/MarkEdit-app/MarkEdit) user-script plugin that adds
a toolbar button to swap the editor between your light and dark themes, live — no
restart.

## Scope

A MarkEdit user script runs inside the editor WebView, so this themes the **editor
surface** (the CodeMirror view) only — not the native macOS window or toolbar
chrome. It is a manual, live override; MarkEdit may re-apply its own
appearance-driven theme when you change the system light/dark setting or relaunch.

## Install

```bash
./install.sh
```

This copies `scripts/theme-toggle.js` into MarkEdit's sandbox at
`~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/`.

Then add the toolbar button: merge `settings.snippet.json` into
`~/Library/Containers/app.cyan.markedit/Data/Documents/settings.json` — specifically
the `editor.customToolbarItems` array — and restart MarkEdit.

## Configure the themes

By default the toggle swaps `github-light` ↔ `github-dark`. Set your own pair in
`settings.json`:

```json
{
  "extension.themeToggle": { "light": "minimal-light", "dark": "minimal-dark" }
}
```

Built-in theme names include `github-*`, `xcode-*`, `solarized-*`, `minimal-*`,
and `winter-is-coming-*` (each with a `-light` and `-dark` variant).

## Use

Click the toolbar button (a half-filled circle), or use **Extensions → Toggle
Light/Dark Theme** from the menu bar. The menu item shows a checkmark when the dark
theme is active.

## Uninstall

Delete `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/theme-toggle.js`,
remove the toolbar entry from `settings.json`, and restart MarkEdit.

## Develop

Run the tests (Node 18+, no dependencies):

```bash
node --test
```

The plugin stays a plain drop-in script; tests load it in a `node:vm` sandbox with
stubbed `MarkEdit`/`window` globals.
```

- [ ] **Step 2: Verify the full test suite passes**

Run: `node --test`
Expected: PASS — all tests from Tasks 1 and 2 pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, config, and scope notes"
```

- [ ] **Step 4: Mark the bean complete**

```bash
beans update markedit-toggle-dark-hp8s -s completed \
  --body-append "## Summary of Changes
Implemented the drop-in script (scripts/theme-toggle.js), node:vm-sandboxed tests, settings snippet, installer, and README."
```

---

## Self-Review

**1. Spec coverage:**
- Toolbar button → Task 2 (`settings.snippet.json`, `menuName`). ✓
- Extensions menu item + shortcut/checkmark → Task 1 (`addMainMenuItem` with `state`). ✓
- Configurable light/dark names → Task 1 (`MarkEdit.userSettings["extension.themeToggle"]`, defaults). ✓
- Live swap via internal bridge → Task 1 (`window.webModules.config.setTheme`). ✓
- Read current theme → Task 1 (`MarkEdit.editorConfig.theme` seeds `activeName`). ✓
- Guard on missing bridge → Task 1 (alert + no-op test). ✓
- Install tooling into sandbox container → Task 2 (`install.sh`, `MARKEDIT_DOCS` override). ✓
- README with install/config/scope/uninstall → Task 3. ✓
- Static "no throw when webModules absent" test → Task 1 (last two tests). ✓
- `menuName` match form documented → README states Extensions menu title; the menu title constant equals the toolbar `menuName`. To confirm at execution: after install, verify the toolbar button fires the menu item; if MarkEdit requires a different `menuName` form, update `settings.snippet.json` and the README note.

**2. Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**3. Type consistency:** `config()` returns `{ light, dark }` used consistently; `applyTheme(name)`/`isDark()`/`toggle()` names match across script and tests; menu item shape `{ title, action, state }` matches the test's captured object and the spec. ✓
