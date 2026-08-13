import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const scriptSrc = readFileSync(join(extensionDir, 'copy-on-select.js'), 'utf8')

// A stand-in for a CodeMirror EditorView. `ranges` is an array of [from, to]
// pairs into `doc`; a pair with from === to is an empty (cursor) range.
function viewOf(doc, ranges) {
    return {
        state: {
            selection: { ranges: ranges.map(([from, to]) => ({ empty: from === to, from, to })) },
            sliceDoc: (from, to) => doc.slice(from, to),
        },
    }
}

// Build a sandbox emulating the MarkEdit WebView, load the drop-in script, and
// return the callbacks it registered plus spies on everything it can call.
function load({
    clipboardError,
    createFileResult = true,
    files = {},
    getFileContentError,
    listFilesError,
    listing,
    userSettings = {},
} = {}) {
    const calls = { alerts: [], created: [], directoryPaths: [], listed: [], warns: [], writeText: [] }
    const documentHandlers = {}
    const domHandlers = {}
    const windowHandlers = {}
    let menuItem = null

    // listFiles defaults to a listing of the stubbed files, so an absent file in
    // `files` is genuinely absent unless a test says otherwise.
    const defaultListing = () => Object.keys(files)

    const MarkEdit = {
        addExtension: extension => {
            Object.assign(domHandlers, extension)
        },
        addMainMenuItem: item => {
            menuItem = item
        },
        createFile: async args => {
            calls.created.push({ ...args })
            return createFileResult
        },
        editorView: undefined,
        getDirectoryPath: name => {
            calls.directoryPaths.push(name)
            return '/docs'
        },
        getFileContent: async path => (getFileContentError ? Promise.reject(getFileContentError) : files[path]),
        listFiles: async path => {
            calls.listed.push(path)
            if (listFilesError) throw listFilesError
            return listing === undefined ? defaultListing() : listing
        },
        showAlert: alert => {
            calls.alerts.push(alert)
        },
        userSettings,
    }

    // domEventHandlers normally returns an opaque CodeMirror extension. Returning
    // the handler map lets a test invoke a handler directly.
    const EditorView = { domEventHandlers: handlers => handlers }

    const requireFn = name => {
        if (name === 'markedit-api') return { MarkEdit }
        if (name === '@codemirror/view') return { EditorView }
        throw new Error(`unknown module: ${name}`)
    }

    const sandbox = {
        console: {
            error: () => {},
            warn: (...args) => {
                calls.warns.push(args.join(' '))
            },
        },
        document: {
            addEventListener: (type, handler) => {
                documentHandlers[type] = handler
            },
        },
        globalThis: undefined,
        navigator: {
            clipboard: {
                // clipboardError is an Error for every write, or a function of the text
                // for a test that needs one write to fail and another to succeed.
                writeText: text => {
                    calls.writeText.push(text)
                    const error = typeof clipboardError === 'function' ? clipboardError(text) : clipboardError
                    return error ? Promise.reject(error) : Promise.resolve()
                },
            },
        },
        require: requireFn,
        window: {
            addEventListener: (type, handler) => {
                windowHandlers[type] = handler
            },
        },
    }
    sandbox.globalThis = sandbox
    vm.createContext(sandbox)
    vm.runInContext(scriptSrc, sandbox, { filename: 'copy-on-select.js' })

    return { calls, documentHandlers, domHandlers, MarkEdit, menuItem, windowHandlers }
}

// A primary-button event. The handlers ignore every other button.
const primary = { button: 0 }

// A complete in-editor gesture: mousedown then mouseup on the editor content.
function dragInEditor(domHandlers, view) {
    domHandlers.mousedown(primary, view)
    domHandlers.mouseup(primary, view)
}

test('a mouseup with a non-empty selection copies the selected text', () => {
    const { calls, domHandlers } = load()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, ['quick'])
})

test('a mouseup with an empty selection copies nothing', () => {
    const { calls, domHandlers } = load()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 4]]))
    assert.deepEqual(calls.writeText, [])
})

test('a multi-range selection joins the ranges with a newline', () => {
    const { calls, domHandlers } = load()
    domHandlers.mouseup(
        primary,
        viewOf('the quick brown fox', [
            [4, 9],
            [10, 15],
        ]),
    )
    assert.deepEqual(calls.writeText, ['quick\nbrown'])
})

test('empty ranges are dropped from a mixed selection', () => {
    const { calls, domHandlers } = load()
    domHandlers.mouseup(
        primary,
        viewOf('the quick brown fox', [
            [4, 9],
            [10, 10],
        ]),
    )
    assert.deepEqual(calls.writeText, ['quick'])
})

test('the mouseup handler returns undefined so CodeMirror keeps its default behavior', () => {
    const { domHandlers } = load()
    assert.equal(domHandlers.mouseup(primary, viewOf('abc', [[0, 3]])), undefined)
})

test('the same text selected twice copies one time', () => {
    const { calls, domHandlers } = load()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, ['quick'])
})

test('a different selection after a repeat copies again', () => {
    const { calls, domHandlers } = load()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[10, 15]]))
    assert.deepEqual(calls.writeText, ['quick', 'brown'])
})

test('identical text at a different position still counts as a repeat', () => {
    const { calls, domHandlers } = load()
    domHandlers.mouseup(primary, viewOf('fox and fox', [[0, 3]]))
    domHandlers.mouseup(primary, viewOf('fox and fox', [[8, 11]]))
    assert.deepEqual(calls.writeText, ['fox'])
})

test('a rejected clipboard write does not throw, and it warns', async () => {
    const { calls, domHandlers } = load({ clipboardError: new Error('denied') })
    assert.doesNotThrow(() => domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]])))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls.warns.length, 1)
    assert.match(calls.warns[0], /copy-on-select/)
    assert.equal(calls.alerts.length, 0, 'a per-selection failure must not alert')
})

test('after a failed write, the same text can be copied again', async () => {
    const { calls, domHandlers } = load({ clipboardError: new Error('denied') })
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    await new Promise(resolve => setImmediate(resolve))
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, ['quick', 'quick'])
})

test('registers a menu item with the exact title', () => {
    const { menuItem } = load()
    assert.ok(menuItem, 'a menu item should be registered')
    assert.equal(menuItem.title, 'Copy on Select')
    assert.equal(typeof menuItem.action, 'function')
    assert.equal(typeof menuItem.state, 'function')
})

test('the extension is on when the settings key is absent', () => {
    const { menuItem } = load()
    assert.equal(menuItem.state().isSelected, true)
})

test('the extension is off when the settings key says so', () => {
    const { menuItem } = load({ userSettings: { 'extension.copyOnSelect': { enabled: false } } })
    assert.equal(menuItem.state().isSelected, false)
})

test('a mouseup copies nothing while the extension is off', () => {
    const { calls, domHandlers } = load({ userSettings: { 'extension.copyOnSelect': { enabled: false } } })
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, [])
})

test('the menu item toggles the state and the copying', () => {
    const { calls, domHandlers, menuItem } = load()
    menuItem.action()
    assert.equal(menuItem.state().isSelected, false)
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, [])

    menuItem.action()
    assert.equal(menuItem.state().isSelected, true)
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, ['quick'])
})

test('turning the extension off clears the repeat record', () => {
    const { calls, domHandlers, menuItem } = load()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    menuItem.action()
    menuItem.action()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, ['quick', 'quick'])
})

// The toggle writes the file in a promise that the caller does not await.
const settled = () => new Promise(resolve => setImmediate(resolve))

test('a toggle writes settings.json and keeps the unrelated keys', async () => {
    const files = { '/docs/settings.json': JSON.stringify({ 'editor.fontSize': 14, 'extension.themeToggle': { dark: 'x' } }) }
    const { calls, menuItem } = load({ files })
    menuItem.action()
    await settled()

    assert.equal(calls.created.length, 1)
    assert.equal(calls.created[0].path, '/docs/settings.json')
    assert.equal(calls.created[0].overwrites, true)
    const written = JSON.parse(calls.created[0].string)
    assert.deepEqual(written['extension.copyOnSelect'], { enabled: false })
    assert.equal(written['editor.fontSize'], 14)
    assert.deepEqual(written['extension.themeToggle'], { dark: 'x' })
})

test('a toggle keeps the unrelated keys inside its own settings object', async () => {
    const files = { '/docs/settings.json': JSON.stringify({ 'extension.copyOnSelect': { enabled: true, note: 'keep me' } }) }
    const { calls, menuItem } = load({ files })
    menuItem.action()
    await settled()
    assert.deepEqual(JSON.parse(calls.created[0].string)['extension.copyOnSelect'], { enabled: false, note: 'keep me' })
})

test('an absent settings.json is written as a new file', async () => {
    const { calls, menuItem } = load()
    menuItem.action()
    await settled()
    assert.equal(calls.created.length, 1)
    assert.deepEqual(JSON.parse(calls.created[0].string), { 'extension.copyOnSelect': { enabled: false } })
})

test('a malformed settings.json alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ files: { '/docs/settings.json': '{ this is not json' } })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [], 'an unparseable file must never be overwritten')
    assert.equal(calls.alerts.length, 1)
    assert.match(calls.alerts[0].message, /settings\.json/)
})

test('a settings.json holding a non-object alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ files: { '/docs/settings.json': '[1, 2, 3]' } })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [])
    assert.equal(calls.alerts.length, 1)
})

test('a failed write alerts', async () => {
    const { calls, menuItem } = load({ createFileResult: false })
    menuItem.action()
    await settled()
    assert.equal(calls.alerts.length, 1)
})

test('a broken settings.json alerts one time for each session', async () => {
    const { calls, menuItem } = load({ files: { '/docs/settings.json': '{ nope' } })
    menuItem.action()
    await settled()
    menuItem.action()
    await settled()
    assert.equal(calls.alerts.length, 1)
})

test('the toggle still works in memory when the file cannot be written', async () => {
    const { calls, domHandlers, menuItem } = load({ createFileResult: false })
    menuItem.action()
    await settled()
    assert.equal(menuItem.state().isSelected, false)
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, [])
})

test('a rejecting file API alerts once and does not throw', async () => {
    const { calls, menuItem } = load({ getFileContentError: new Error('disk error') })
    assert.doesNotThrow(() => menuItem.action())
    await settled()
    assert.deepEqual(calls.created, [])
    assert.equal(calls.alerts.length, 1)
})

test('a drag that starts in the editor and ends outside copies through MarkEdit.editorView', () => {
    const { calls, documentHandlers, domHandlers, MarkEdit } = load()
    const view = viewOf('the quick brown fox', [[4, 9]])
    MarkEdit.editorView = view
    domHandlers.mousedown(primary, view)
    documentHandlers.mouseup(primary)
    assert.deepEqual(calls.writeText, ['quick'])
})

// getFileContent gives undefined when the read fails, not when the file is
// absent. A write then replaces every MarkEdit setting with this one key.
test('an unreadable settings.json alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ listing: ['/docs/settings.json'] })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [], 'a file that can be listed must never be replaced')
    assert.equal(calls.alerts.length, 1)
    assert.match(calls.alerts[0].message, /settings\.json/)
})

test('a listing of bare names also proves that settings.json is present', async () => {
    const { calls, menuItem } = load({ listing: ['settings.json', 'scripts'] })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [])
    assert.equal(calls.alerts.length, 1)
})

test('a failed listing alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ listing: false })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [], 'absence that cannot be proved must never be assumed')
    assert.equal(calls.alerts.length, 1)
})

test('a rejecting listFiles alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ listFilesError: new Error('no such directory') })
    assert.doesNotThrow(() => menuItem.action())
    await settled()
    assert.deepEqual(calls.created, [])
    assert.equal(calls.alerts.length, 1)
})

test('the listing reads the documents directory', async () => {
    const { calls, menuItem } = load()
    menuItem.action()
    await settled()
    assert.deepEqual(calls.listed, ['/docs'])
})

// A wrong literal here writes to undefined/settings.json in the real app.
test('the settings path comes from the documents directory', async () => {
    const { calls, menuItem } = load()
    menuItem.action()
    await settled()
    assert.deepEqual(calls.directoryPaths, ['documents'])
    assert.equal(calls.created[0].path, '/docs/settings.json')
})

test('a mouseup on the document does nothing when the editor view is absent', () => {
    const { calls, documentHandlers, domHandlers } = load()
    domHandlers.mousedown(primary, undefined)
    assert.doesNotThrow(() => documentHandlers.mouseup(primary))
    assert.deepEqual(calls.writeText, [])
})

test('both handlers running for one gesture copies one time', () => {
    const { calls, documentHandlers, domHandlers, MarkEdit } = load()
    const view = viewOf('the quick brown fox', [[4, 9]])
    MarkEdit.editorView = view
    dragInEditor(domHandlers, view)
    documentHandlers.mouseup(primary)
    assert.deepEqual(calls.writeText, ['quick'])
})

test('the backstop obeys the off state', () => {
    const { calls, documentHandlers, domHandlers, MarkEdit } = load({ userSettings: { 'extension.copyOnSelect': { enabled: false } } })
    const view = viewOf('the quick brown fox', [[4, 9]])
    MarkEdit.editorView = view
    domHandlers.mousedown(primary, view)
    documentHandlers.mouseup(primary)
    assert.deepEqual(calls.writeText, [])
})

// A mouseup on the gutter, on a panel, or on a scroller misses the CodeMirror
// handler and reaches the backstop only. A keyboard selection is live then, and
// copying it would destroy what Command-C put on the clipboard.
test('a backstop mouseup with no gesture in the editor copies nothing', () => {
    const { calls, documentHandlers, MarkEdit } = load()
    MarkEdit.editorView = viewOf('the quick brown fox', [[4, 9]])
    documentHandlers.mouseup(primary)
    assert.deepEqual(calls.writeText, [], 'a keyboard selection must never reach the clipboard')
})

test('a backstop mouseup after a finished gesture copies nothing', () => {
    const { calls, documentHandlers, domHandlers, MarkEdit } = load()
    const view = viewOf('the quick brown fox', [[4, 9]])
    MarkEdit.editorView = view
    dragInEditor(domHandlers, view)
    documentHandlers.mouseup(primary)
    documentHandlers.mouseup(primary)
    assert.deepEqual(calls.writeText, ['quick'])
})

test('a non-primary button copies nothing in the editor', () => {
    const { calls, domHandlers } = load()
    const view = viewOf('the quick brown fox', [[4, 9]])
    domHandlers.mousedown({ button: 2 }, view)
    domHandlers.mouseup({ button: 2 }, view)
    assert.deepEqual(calls.writeText, [])
})

test('a non-primary button copies nothing through the backstop', () => {
    const { calls, documentHandlers, domHandlers, MarkEdit } = load()
    const view = viewOf('the quick brown fox', [[4, 9]])
    MarkEdit.editorView = view
    domHandlers.mousedown(primary, view)
    documentHandlers.mouseup({ button: 1 })
    assert.deepEqual(calls.writeText, [])
})

test('a non-primary mousedown does not arm the backstop', () => {
    const { calls, documentHandlers, domHandlers, MarkEdit } = load()
    const view = viewOf('the quick brown fox', [[4, 9]])
    MarkEdit.editorView = view
    domHandlers.mousedown({ button: 2 }, view)
    documentHandlers.mouseup(primary)
    assert.deepEqual(calls.writeText, [])
})

test('the mousedown handler returns undefined so CodeMirror keeps its default behavior', () => {
    const { domHandlers } = load()
    assert.equal(domHandlers.mousedown(primary, viewOf('abc', [[0, 3]])), undefined)
})

// lastCopied records what this extension wrote. It is no longer evidence of
// what is on the clipboard once something else can have replaced it.
test('the same text copies again after the window loses focus', () => {
    const { calls, domHandlers, windowHandlers } = load()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    windowHandlers.blur()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, ['quick', 'quick'])
})

test('the same text copies again after a copy event', () => {
    const { calls, documentHandlers, domHandlers } = load()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    documentHandlers.copy({})
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, ['quick', 'quick'])
})

test('a repeat with no blur and no copy is still skipped', () => {
    const { calls, domHandlers } = load()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    assert.deepEqual(calls.writeText, ['quick'], 'the flood protection must survive')
})

// The rejection of the first write arrives after a second selection owns the
// record. Clearing it then would let a third identical selection write again.
test('a late clipboard rejection does not clear a newer record', async () => {
    const { calls, domHandlers } = load({ clipboardError: text => (text === 'quick' ? new Error('denied') : undefined) })
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[4, 9]]))
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[10, 15]]))
    await settled()
    domHandlers.mouseup(primary, viewOf('the quick brown fox', [[10, 15]]))
    assert.deepEqual(calls.writeText, ['quick', 'brown'])
})
