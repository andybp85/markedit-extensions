import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = join(repoDir, 'extensions');
const installer = join(repoDir, 'install.sh');

const extensionNames = () =>
  readdirSync(extensionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

const scriptsOf = name =>
  readdirSync(join(extensionsDir, name), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name);

// Run install.sh against a throwaway MARKEDIT_DOCS and hand the sandbox
// contents to `check`, then clean up.
const withSandbox = (args, check) => {
  const docs = mkdtempSync(join(tmpdir(), 'markedit-docs-'));
  try {
    const stdout = execFileSync('bash', [installer, ...args], {
      encoding: 'utf8',
      env: { ...process.env, MARKEDIT_DOCS: docs }
    });
    check({ docs, installed: readdirSync(join(docs, 'scripts')), stdout });
  } finally {
    rmSync(docs, { force: true, recursive: true });
  }
};

test('with no arguments, installs every extension script', () => {
  const expected = extensionNames().flatMap(scriptsOf).sort();
  assert.ok(expected.length > 0, 'the repo should ship at least one extension script');
  withSandbox([], ({ installed }) => assert.deepEqual(installed.sort(), expected));
});

test('installed scripts are byte-identical to the sources', () => {
  withSandbox([], ({ docs }) => {
    for (const name of extensionNames())
      for (const script of scriptsOf(name))
        assert.equal(
          readFileSync(join(docs, 'scripts', script), 'utf8'),
          readFileSync(join(extensionsDir, name, script), 'utf8'),
          `${name}/${script} should be copied verbatim`
        );
  });
});

test('a named extension installs only its own scripts', () => {
  const [name] = extensionNames();
  withSandbox([name], ({ installed }) => assert.deepEqual(installed.sort(), scriptsOf(name).sort()));
});

test('test files are not installed into the sandbox', () => {
  withSandbox([], ({ installed }) =>
    assert.equal(installed.filter(file => file.includes('.test.')).length, 0)
  );
});

test('an unknown extension name fails loudly and installs nothing', () => {
  const docs = mkdtempSync(join(tmpdir(), 'markedit-docs-'));
  try {
    assert.throws(
      () =>
        execFileSync('bash', [installer, 'no-such-extension'], {
          encoding: 'utf8',
          env: { ...process.env, MARKEDIT_DOCS: docs },
          stdio: 'pipe'
        }),
      /no such extension/
    );
    assert.equal(existsSync(join(docs, 'scripts')), false, 'nothing should have been written');
  } finally {
    rmSync(docs, { force: true, recursive: true });
  }
});
