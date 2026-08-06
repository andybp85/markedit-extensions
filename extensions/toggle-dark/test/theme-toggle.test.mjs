import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptSrc = readFileSync(join(extensionDir, 'theme-toggle.js'), 'utf8');

// Build a sandbox emulating the MarkEdit WebView, load the drop-in script,
// and return the captured menu item plus spies.
function load({ userSettings = {}, theme = 'github-light', webModules = 'default' } = {}) {
  const calls = { setTheme: [], alerts: [] };
  let menuItem = null;

  // Copy the arg into this realm; objects created inside the vm sandbox carry
  // a different prototype, which would break deepStrictEqual across realms.
  const setThemeFn = (arg) => { calls.setTheme.push({ name: arg && arg.name }); };
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

  // Mirror the real MarkEdit scripts/ runtime: the API is delivered as a
  // CommonJS module via require("markedit-api"), not as a bare global.
  const requireFn = (name) => {
    if (name === 'markedit-api') return { MarkEdit };
    throw new Error(`unknown module: ${name}`);
  };

  const sandbox = { require: requireFn, window: win, globalThis: undefined };
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
