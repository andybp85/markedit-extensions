import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..')

test('settings.snippet.json is valid JSON with the toolbar item', () => {
    const snippet = JSON.parse(readFileSync(join(extensionDir, 'settings.snippet.json'), 'utf8'))
    const items = snippet['editor.customToolbarItems']
    assert.ok(Array.isArray(items) && items.length === 1)
    assert.equal(items[0].title, 'Toggle Theme')
    assert.equal(typeof items[0].icon, 'string')
    assert.ok(items[0].icon.length > 0)
    // JS-registered menu items are invoked from the toolbar via actionName
    // matching the menu item title (see markedit-preview's "Change Mode").
    assert.equal(items[0].actionName, 'Toggle Light/Dark Theme')
    assert.equal(items[0].menuName, undefined)
})

test('the toolbar actionName matches the title the script registers', () => {
    // Cross-file invariant: if these drift, the button binds to nothing.
    const snippet = JSON.parse(readFileSync(join(extensionDir, 'settings.snippet.json'), 'utf8'))
    const script = readFileSync(join(extensionDir, 'theme-toggle.js'), 'utf8')
    const titleMatch = script.match(/MENU_TITLE\s*=\s*['"]([^'"]+)['"]/)
    assert.ok(titleMatch, 'script should define MENU_TITLE')
    assert.equal(snippet['editor.customToolbarItems'][0].actionName, titleMatch[1])
})
