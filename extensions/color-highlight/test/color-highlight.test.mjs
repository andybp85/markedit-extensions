import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const scriptSrc = readFileSync(join(extensionDir, 'color-highlight.js'), 'utf8')

// A chain of fake elements, innermost first. `editorBackground` walks it with
// `parentElement` and reads each one with `getComputedStyle`.
function domChain(backgrounds) {
    let element = null
    for (const backgroundColor of [...backgrounds].reverse()) element = { backgroundColor, parentElement: element }
    return element
}

// A stand-in for a CodeMirror EditorView over `text`. `visibleRanges` defaults
// to the whole document; a test passes its own to check that the plugin scans
// only what is on the screen.
function viewOf(text, { backgrounds = ['rgb(255, 255, 255)'], visibleRanges } = {}) {
    const lines = []
    let from = 0
    for (const lineText of text.split('\n')) {
        lines.push({ from, text: lineText, to: from + lineText.length })
        from += lineText.length + 1
    }

    return {
        contentDOM: domChain(backgrounds),
        state: { doc: { lineAt: pos => lines.find(line => pos >= line.from && pos <= line.to) } },
        visibleRanges: visibleRanges ?? [{ from: 0, to: text.length }],
    }
}

// Build a sandbox emulating the MarkEdit WebView, load the drop-in script, and
// return what it registered plus spies on everything it can call.
function load({ userSettings = {} } = {}) {
    const calls = { alerts: [] }
    const extensions = []
    let menuItem = null

    const MarkEdit = {
        addExtension: extension => {
            extensions.push(extension)
        },
        addMainMenuItem: item => {
            menuItem = item
        },
        editorView: undefined,
        showAlert: alert => {
            calls.alerts.push(alert)
        },
        userSettings,
    }

    // Decoration.mark returns its spec, so a test can read the style string.
    const Decoration = { mark: spec => spec }
    // The real builder returns an opaque RangeSet. This one returns the ranges.
    class RangeSetBuilder {
        constructor() {
            this.ranges = []
        }

        add(from, to, value) {
            this.ranges.push({ from, to, value })
        }

        finish() {
            return this.ranges
        }
    }
    // define() returns a type, the type's of() makes an effect, and it is the
    // effect that answers is(type) — the direction the real API reads, and the
    // one the plugin asks in.
    const StateEffect = {
        define: () => {
            const type = { of: value => ({ is: candidate => candidate === type, value }) }
            return type
        },
    }
    // fromClass normally returns an opaque extension. Returning the class lets a
    // test construct the plugin with a fake view.
    const ViewPlugin = { fromClass: pluginClass => pluginClass }

    const requireFn = name => {
        if (name === 'markedit-api') return { MarkEdit }
        if (name === '@codemirror/view') return { Decoration, ViewPlugin }
        if (name === '@codemirror/state') return { RangeSetBuilder, StateEffect }
        throw new Error(`unknown module: ${name}`)
    }

    const sandbox = {
        console: { error: () => {}, warn: () => {} },
        globalThis: undefined,
        require: requireFn,
        window: { getComputedStyle: element => ({ backgroundColor: element.backgroundColor }) },
    }
    sandbox.globalThis = sandbox
    vm.createContext(sandbox)
    vm.runInContext(scriptSrc, sandbox, { filename: 'color-highlight.js' })

    return { calls, extensions, MarkEdit, menuItem }
}

// Construct the plugin over a view and flatten its decorations for assertion.
function decorationsOf({ extensions }, view) {
    return new extensions[0](view).decorations.map(range => ({
        from: range.from,
        style: range.value.attributes.style,
        to: range.to,
    }))
}

// Load the script and paint one document in one call.
function paint(text, options = {}) {
    return decorationsOf(load(options), viewOf(text, options))
}

// The exact style string the extension writes, so a test names a colour once.
const style = (rgba, text) => `background-color: ${rgba}; color: ${text}; border-radius: 3px;`

test('a six-digit hex token paints with its own colour', () => {
    assert.deepEqual(paint('color: #ff0000;'), [{ from: 7, style: style('rgba(255, 0, 0, 1)', '#000000'), to: 14 }])
})

test('a dark colour takes white text', () => {
    assert.deepEqual(paint('color: #000080;'), [{ from: 7, style: style('rgba(0, 0, 128, 1)', '#ffffff'), to: 14 }])
})

// The contrast ratios against black and white are equal at L = 0.17912878.
// #757575 sits just below it and #767676 just above.
test('the black and white choice flips at the luminance threshold', () => {
    assert.equal(paint('a #757575')[0].style, style('rgba(117, 117, 117, 1)', '#ffffff'))
    assert.equal(paint('a #767676')[0].style, style('rgba(118, 118, 118, 1)', '#000000'))
})

test('an uppercase hex token paints', () => {
    assert.equal(paint('a #FF0000')[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
})

test('several colours on one line produce several decorations, in order', () => {
    const painted = paint('a #ff0000 b #0000ff')
    assert.deepEqual(
        painted.map(range => range.from),
        [2, 12],
    )
})

test('a colour on a later line gets the offset of that line', () => {
    assert.deepEqual(paint('one\ntwo #ff0000'), [{ from: 8, style: style('rgba(255, 0, 0, 1)', '#000000'), to: 15 }])
})

test('a line outside the visible ranges is not scanned', () => {
    const loaded = load()
    const view = viewOf('a #ff0000\nb #0000ff', { visibleRanges: [{ from: 0, to: 9 }] })
    assert.deepEqual(
        decorationsOf(loaded, view).map(range => range.from),
        [2],
    )
})

test('a three-digit hex token doubles each digit', () => {
    assert.deepEqual(paint('a #f8c'), [{ from: 2, style: style('rgba(255, 136, 204, 1)', '#000000'), to: 6 }])
})

test('a hex run of an undefined length paints nothing', () => {
    assert.deepEqual(paint('a #12345'), [])
    assert.deepEqual(paint('a #1234567'), [])
})

// CANDIDATE only matches hex digits, so the candidate here is #abcdef — six
// digits that parse fine on their own. It is the trailing guard that refuses
// it, because a word character ("g") immediately follows the match.
test('a hex run followed by more letters paints nothing', () => {
    assert.deepEqual(paint('a #abcdefgh'), [])
})

test('a hex token after a word character paints nothing', () => {
    assert.deepEqual(paint('word#ff0000'), [])
    assert.deepEqual(paint('a ##ff0000'), [])
})

test('a hex token that opens a line paints nothing', () => {
    assert.deepEqual(paint('#face'), [])
    assert.deepEqual(paint('    #face'), [])
    assert.deepEqual(paint('one\n#ff0000'), [])
})

test('a hex token after a list marker or a word on the same line paints', () => {
    assert.equal(paint('- #ff0000').length, 1)
    assert.equal(paint('The brand is #ff0000').length, 1)
    assert.equal(paint('color: #ff0000;').length, 1)
})

test('rgb() paints, in the comma syntax and in the space syntax', () => {
    assert.deepEqual(paint('a rgb(255, 0, 0)'), [{ from: 2, style: style('rgba(255, 0, 0, 1)', '#000000'), to: 16 }])
    assert.equal(paint('a rgb(255 0 0)')[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
})

test('rgb() that opens a line paints, because the heading rule is for hex only', () => {
    assert.equal(paint('rgb(255, 0, 0)').length, 1)
})

test('percentage channels paint the same colour as the equivalent numbers', () => {
    assert.equal(paint('a rgb(100%, 0%, 0%)')[0].style, paint('a rgb(255, 0, 0)')[0].style)
})

test('a channel out of range is clamped, not refused', () => {
    assert.equal(paint('a rgb(300, -20, 0)')[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
})

test('a functional form with the wrong number of arguments paints nothing', () => {
    assert.deepEqual(paint('a rgb(1, 2)'), [])
    assert.deepEqual(paint('a rgb(1, 2, 3, 4, 5)'), [])
    assert.deepEqual(paint('a rgb()'), [])
})

test('a functional form with an unparseable channel paints nothing', () => {
    assert.deepEqual(paint('a rgb(a, b, c)'), [])
    assert.deepEqual(paint('a rgb(none, 0, 0)'), [])
})

// `[^()\n]*` in CANDIDATE cannot cross the inner "(", so no candidate is found
// anywhere on this line and parseColor is never called for it.
test('a functional form holding a nested parenthesis is not a candidate', () => {
    assert.deepEqual(paint('a rgb(calc(1px), 0, 0)'), [])
})

// `\b` in CANDIDATE anchors the left of `rgb` only, so a functional form glued
// to trailing word characters is refused by the trailing guard rather than by
// the pattern — the same rule that refuses `#ff0000word`.
test('a functional form followed by a word character paints nothing', () => {
    assert.deepEqual(paint('rgb(255, 0, 0)word'), [])
    assert.deepEqual(paint('a rgb(255, 0, 0)word'), [])
})

test('a word ending in rgb is not a functional form', () => {
    assert.deepEqual(paint('a srgb(255, 0, 0)'), [])
})

test('uppercase RGB paints', () => {
    assert.equal(paint('a RGB(255, 0, 0)')[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
})

test('a four-digit hex token doubles each digit, alpha included', () => {
    assert.equal(paint('a #f00c')[0].style, style('rgba(255, 0, 0, 0.8)', '#000000'))
})

test('an eight-digit hex token carries its alpha', () => {
    assert.equal(paint('a #ff000080')[0].style, style('rgba(255, 0, 0, 0.502)', '#000000'))
})

test('rgba() carries its alpha, as a fourth argument and after a slash', () => {
    assert.equal(paint('a rgba(255, 0, 0, 0.5)')[0].style, style('rgba(255, 0, 0, 0.5)', '#000000'))
    assert.equal(paint('a rgb(255 0 0 / 0.5)')[0].style, style('rgba(255, 0, 0, 0.5)', '#000000'))
    assert.equal(paint('a rgb(255 0 0 / 50%)')[0].style, style('rgba(255, 0, 0, 0.5)', '#000000'))
})

test('an unparseable alpha paints nothing', () => {
    assert.deepEqual(paint('a rgba(255, 0, 0, half)'), [])
    assert.deepEqual(paint('a rgb(255 0 0 / )'), [])
})

test('an alpha out of range is clamped', () => {
    assert.equal(paint('a rgba(255, 0, 0, 7)')[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
})

// White at one tenth opacity is nearly the background. On a light editor it
// needs black text; on a dark editor the very same token needs white.
test('a transparent colour composites over the editor before the choice', () => {
    const faint = 'a rgba(255, 255, 255, 0.1)'
    assert.equal(paint(faint, { backgrounds: ['rgb(255, 255, 255)'] })[0].style, style('rgba(255, 255, 255, 0.1)', '#000000'))
    assert.equal(paint(faint, { backgrounds: ['rgb(0, 0, 0)'] })[0].style, style('rgba(255, 255, 255, 0.1)', '#ffffff'))
})

test('an opaque colour ignores the editor background', () => {
    assert.equal(paint('a #ff0000', { backgrounds: ['rgb(0, 0, 0)'] })[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
})

test('a transparent content element takes the background of an ancestor', () => {
    const painted = paint('a rgba(255, 255, 255, 0.1)', { backgrounds: ['rgba(0, 0, 0, 0)', 'rgb(0, 0, 0)'] })
    assert.equal(painted[0].style, style('rgba(255, 255, 255, 0.1)', '#ffffff'))
})

test('an editor with no usable background is treated as white', () => {
    const painted = paint('a rgba(255, 255, 255, 0.1)', { backgrounds: ['transparent'] })
    assert.equal(painted[0].style, style('rgba(255, 255, 255, 0.1)', '#000000'))
})

test('hsl() converts the primaries and the secondaries', () => {
    assert.equal(paint('a hsl(0, 100%, 50%)')[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
    assert.equal(paint('a hsl(120, 100%, 50%)')[0].style, style('rgba(0, 255, 0, 1)', '#000000'))
    assert.equal(paint('a hsl(240, 100%, 50%)')[0].style, style('rgba(0, 0, 255, 1)', '#ffffff'))
    assert.equal(paint('a hsl(60, 100%, 50%)')[0].style, style('rgba(255, 255, 0, 1)', '#000000'))
})

test('zero saturation is a grey of the lightness', () => {
    assert.equal(paint('a hsl(0, 0%, 50%)')[0].style, style('rgba(128, 128, 128, 1)', '#000000'))
    assert.equal(paint('a hsl(210, 0%, 0%)')[0].style, style('rgba(0, 0, 0, 1)', '#ffffff'))
    assert.equal(paint('a hsl(210, 0%, 100%)')[0].style, style('rgba(255, 255, 255, 1)', '#000000'))
})

test('a hue outside 0..360 wraps in both directions', () => {
    assert.equal(paint('a hsl(480, 100%, 50%)')[0].style, paint('a hsl(120, 100%, 50%)')[0].style)
    assert.equal(paint('a hsl(-120, 100%, 50%)')[0].style, paint('a hsl(240, 100%, 50%)')[0].style)
})

test('the space syntax, a deg hue, and an alpha all paint', () => {
    assert.equal(paint('a hsl(0deg 100% 50%)')[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
    assert.equal(paint('a hsl(0deg 100% 50% / 50%)')[0].style, style('rgba(255, 0, 0, 0.5)', '#000000'))
    assert.equal(paint('a hsla(0, 100%, 50%, 0.5)')[0].style, style('rgba(255, 0, 0, 0.5)', '#000000'))
})

test('saturation and lightness read the same with or without the percent', () => {
    assert.equal(paint('a hsl(0 100 50)')[0].style, paint('a hsl(0, 100%, 50%)')[0].style)
})

test('a hue in a unit this parser does not know paints nothing', () => {
    assert.deepEqual(paint('a hsl(0.5turn, 100%, 50%)'), [])
    assert.deepEqual(paint('a hsl(1rad, 100%, 50%)'), [])
})

// NUMBER accepts a trailing percent because two of the three hsl() arguments
// are percentages. The hue is not one of them in any CSS syntax, so a hue
// written that way is a token no engine accepts and nothing is painted.
test('a percentage hue paints nothing', () => {
    assert.deepEqual(paint('a hsl(50%, 100%, 50%)'), [])
    assert.deepEqual(paint('a hsl(50% 100% 50%)'), [])
})

// The plugin sees a toggle as a transaction carrying the repaint effect. A
// dispatch spec may name one effect or several; a real transaction always
// exposes an array, so the effect the toggle dispatched is wrapped in one here.
const repaintUpdate = (loaded, view) => ({
    docChanged: false,
    transactions: [{ effects: [loaded.MarkEdit.editorView.dispatched.at(-1).effects].flat() }],
    view,
    viewportChanged: false,
})

test('registers a menu item with the exact title', () => {
    const { menuItem } = load()
    assert.ok(menuItem, 'a menu item should be registered')
    assert.equal(menuItem.title, 'Highlight Colors')
    assert.equal(typeof menuItem.action, 'function')
    assert.equal(typeof menuItem.state, 'function')
})

test('the extension is on when the settings key is absent', () => {
    assert.equal(load().menuItem.state().isSelected, true)
})

test('the extension is off when the settings key says so', () => {
    const { menuItem } = load({ userSettings: { 'extension.colorHighlight': { enabled: false } } })
    assert.equal(menuItem.state().isSelected, false)
})

test('nothing is painted while the extension is off', () => {
    assert.deepEqual(paint('a #ff0000', { userSettings: { 'extension.colorHighlight': { enabled: false } } }), [])
})

test('the menu item flips the state', () => {
    const { menuItem } = load()
    menuItem.action()
    assert.equal(menuItem.state().isSelected, false)
    menuItem.action()
    assert.equal(menuItem.state().isSelected, true)
})

test('a toggle dispatches the repaint effect, and the plugin rebuilds on it', () => {
    const loaded = load()
    const view = viewOf('a #ff0000')
    loaded.MarkEdit.editorView = { dispatch: spec => loaded.MarkEdit.editorView.dispatched.push(spec), dispatched: [] }

    const instance = new loaded.extensions[0](view)
    assert.equal(instance.decorations.length, 1)

    loaded.menuItem.action()
    assert.equal(loaded.MarkEdit.editorView.dispatched.length, 1)
    instance.update(repaintUpdate(loaded, view))
    assert.deepEqual(instance.decorations, [], 'the flip should take effect at once')
})

test('a toggle with no editor view does not throw', () => {
    const { menuItem } = load()
    assert.doesNotThrow(() => menuItem.action())
    assert.equal(menuItem.state().isSelected, false)
})

test('an unrelated transaction does not rebuild', () => {
    const loaded = load()
    const view = viewOf('a #ff0000')
    const instance = new loaded.extensions[0](view)
    const before = instance.decorations
    instance.update({ docChanged: false, transactions: [{ effects: [] }], view, viewportChanged: false })
    assert.equal(instance.decorations, before, 'the set should be the same object, not a rebuild')
})
