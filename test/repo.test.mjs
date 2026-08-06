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
    assert.ok(
      existsSync(join(dir, 'test')) && statSync(join(dir, 'test')).isDirectory(),
      `${name} should have a test directory`
    );
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
