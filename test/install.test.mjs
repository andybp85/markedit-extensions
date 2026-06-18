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
  assert.equal(items[0].title, 'Toggle Theme');
  assert.equal(typeof items[0].icon, 'string');
  assert.ok(items[0].icon.length > 0);
  // JS-registered menu items are invoked from the toolbar via actionName
  // matching the menu item title (see markedit-preview's "Change Mode").
  assert.equal(items[0].actionName, 'Toggle Light/Dark Theme');
  assert.equal(items[0].menuName, undefined);
  // Cross-file invariant: the toolbar actionName must equal the title the
  // script registers, or the button binds to nothing.
  const script = readFileSync(join(repo, 'scripts', 'theme-toggle.js'), 'utf8');
  const titleMatch = script.match(/MENU_TITLE\s*=\s*"([^"]+)"/);
  assert.ok(titleMatch, 'script should define MENU_TITLE');
  assert.equal(items[0].actionName, titleMatch[1]);
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
