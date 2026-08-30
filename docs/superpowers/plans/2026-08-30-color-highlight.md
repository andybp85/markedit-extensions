# Color Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paint every hex, `rgb()` and `hsl()` color token in the MarkEdit editor with the color it names, and set the
token's text to black or white by WCAG relative luminance.

**Architecture:** One drop-in script, `extensions/color-highlight/color-highlight.js`. Its first half is pure colour
code — a candidate regex, a parser that returns `{ a, b, g, r }` or `undefined`, and the contrast maths — and knows
nothing of CodeMirror or the DOM. Its second half is a `ViewPlugin` that walks the lines of the visible ranges, calls the
first half, and builds a `DecorationSet` of `Decoration.mark`s carrying an inline style.

**Tech Stack:** Plain JavaScript, no build step, no runtime dependencies. `markedit-api`, `@codemirror/view` and
`@codemirror/state` come from the MarkEdit script runtime through `require`. Tests are `node --test` with a `node:vm`
sandbox.

**Spec:** `docs/superpowers/specs/2026-08-30-color-highlight-design.md`

## Global Constraints

- Node 20 or later. No runtime dependencies; `oxlint` and `oxfmt` are devDependencies and nothing in an extension
  imports them.
- Formatting is `oxfmt`: no semicolons, single quotes, 4-space indent, 140-column lines, trailing commas, and arrow
  parameters without parentheses. Run `npm run format` before every commit.
- `oxlint` runs `curly: ["error", "multi"]`. A single-statement `if`, `for` or `while` body takes **no** braces; a
  multi-statement body takes them. Also `no-var`, `prefer-const`, `no-unused-vars`, and `no-console` except `warn` and
  `error`.
- The script is one IIFE with `'use strict'`, in the style of `extensions/copy-on-select/copy-on-select.js`.
- Object literal keys are written in alphabetical order, matching the two existing extensions. It is a house habit, not
  a lint rule.
- Settings key: `extension.colorHighlight`. Menu title: `Highlight Colors`. Neither is spelled any other way anywhere.
- A pre-commit guard runs lint and format on staged files. It reports and stops; it never rewrites.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `extensions/color-highlight/color-highlight.js` | The whole extension: colour core, view plugin, menu item, persistence |
| `extensions/color-highlight/test/color-highlight.test.mjs` | Every test, driving the plugin through a `node:vm` sandbox |
| `extensions/color-highlight/README.md` | What it does, how to install it, the settings key, the known limit |
| `README.md` | One row in the table of extensions |
| `CHANGELOG.md` | A `1.2.0` entry |
| `package.json` | Version `1.2.0` |

There is no `settings.snippet.json`. The toggle writes its own key, in the manner of `copy-on-select`.

---

## Task 1: Harness, six-digit hex, and the contrast choice

The thin end-to-end slice. It stands up the sandbox, the plugin, the line walk and the WCAG maths, and paints exactly
one shape: a six-digit hex token.

**Files:**

- Create: `extensions/color-highlight/color-highlight.js`
- Test: `extensions/color-highlight/test/color-highlight.test.mjs`

**Interfaces:**

- Consumes: nothing.
- Produces: the sandbox helpers `load(options)`, `viewOf(text, options)`, `decorationsOf(loaded, view)`,
  `paint(text, options)` and `style(rgba, text)`, which every later task reuses. In the script: `CANDIDATE`,
  `parseColor(source) -> {a, b, g, r} | undefined`, `contrastColor(color, background) -> string`,
  `findColors(line) -> [{color, from, to}]`, `buildDecorations(view) -> DecorationSet`.

- [ ] **Step 1: Write the failing test**

Create `extensions/color-highlight/test/color-highlight.test.mjs`:

```javascript
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
    const StateEffect = {
        define: () => {
            const type = { is: effect => effect.type === type, of: value => ({ type, value }) }
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: FAIL. `readFileSync` throws `ENOENT` because `color-highlight.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `extensions/color-highlight/color-highlight.js`:

```javascript
/*
 * MarkEdit Color Highlight
 * Paints every hex, rgb() and hsl() colour with the colour it names.
 * Drop this file into MarkEdit's `scripts/` directory.
 *
 * API: https://github.com/MarkEdit-app/MarkEdit/wiki/Customization#markedit-api
 */
;(() => {
    'use strict'

    // In MarkEdit's scripts/ runtime the API and the CodeMirror modules are
    // CommonJS modules, not globals.
    const { MarkEdit } = require('markedit-api')
    const { Decoration, ViewPlugin } = require('@codemirror/view')
    const { RangeSetBuilder } = require('@codemirror/state')

    // A candidate is a shape that could be a colour. It is deliberately loose:
    // parseColor is what decides. The run of hex digits is greedy so that
    // #abcdefgh yields one candidate of eight characters, which does not parse,
    // rather than #abcdef out of the middle of a longer word.
    const CANDIDATE = /#[0-9a-f]+/gi

    const HEX_LENGTHS = new Set([6])

    // Returns { a, b, g, r } with r, g and b in 0..255 and a in 0..1, or
    // undefined. Everything downstream therefore holds a real colour.
    const parseColor = source => {
        const digits = source.slice(1)
        if (!HEX_LENGTHS.has(digits.length)) return undefined
        const channel = index => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16)
        return { a: 1, b: channel(2), g: channel(1), r: channel(0) }
    }

    const linearize = value => {
        const channel = value / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }

    const luminance = ({ b, g, r }) => 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)

    // The contrast ratio against white is 1.05 / (L + 0.05) and against black is
    // (L + 0.05) / 0.05. They are equal at L = 0.17912878, so above that black
    // reads better and below it white does.
    const THRESHOLD = 0.179

    const contrastColor = color => (luminance(color) > THRESHOLD ? '#000000' : '#ffffff')

    // A sweep runs over one line, which is what makes the rules that reject a
    // candidate expressible at all: neither "first on the line" nor "preceded by
    // a word character" means anything against a slice of arbitrary text.
    const findColors = line => {
        const found = []
        CANDIDATE.lastIndex = 0
        for (let match = CANDIDATE.exec(line); match !== null; match = CANDIDATE.exec(line)) {
            const color = parseColor(match[0])
            if (color !== undefined) found.push({ color, from: match.index, to: match.index + match[0].length })
        }
        return found
    }

    const mark = color =>
        Decoration.mark({
            attributes: {
                style:
                    `background-color: rgba(${color.r}, ${color.g}, ${color.b}, ${color.a}); ` +
                    `color: ${contrastColor(color)}; border-radius: 3px;`,
            },
        })

    // Only the visible ranges are walked, so the work is bounded by the screen
    // and not by the size of the document.
    const buildDecorations = view => {
        const builder = new RangeSetBuilder()

        for (const { from, to } of view.visibleRanges) {
            let pos = from
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos)
                for (const found of findColors(line.text))
                    builder.add(line.from + found.from, line.from + found.to, mark(found.color))
                pos = line.to + 1
            }
        }
        return builder.finish()
    }

    MarkEdit.addExtension(
        ViewPlugin.fromClass(
            class {
                constructor(view) {
                    this.decorations = buildDecorations(view)
                }

                update(update) {
                    if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view)
                }
            },
            { decorations: instance => instance.decorations },
        ),
    )
})()
```

`contrastColor` and `mark` take no background yet. Nothing here is transparent, so nothing is behind anything, and a
parameter that no caller can vary would fail `no-unused-vars` for two tasks. Task 4 adds it at the point it earns its
place.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: PASS, 7 tests.

- [ ] **Step 5: Lint, format, and commit**

```bash
npm run lint && npm run format && npm test
git add extensions/color-highlight/
git commit -m "feat(color-highlight): paint six-digit hex colours"
```

---

## Task 2: The rest of hex, and the rules that reject a candidate

Three-digit hex, and the three ways a hex-shaped token turns out not to be a colour.

**Files:**

- Modify: `extensions/color-highlight/color-highlight.js`
- Test: `extensions/color-highlight/test/color-highlight.test.mjs`

**Interfaces:**

- Consumes: `paint`, `style` from Task 1.
- Produces: `opensLine(line, index) -> boolean`; `parseColor` accepting hex of length 3 and 6.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/color-highlight/test/color-highlight.test.mjs`:

```javascript
test('a three-digit hex token doubles each digit', () => {
    assert.deepEqual(paint('a #f8c'), [{ from: 2, style: style('rgba(255, 136, 204, 1)', '#000000'), to: 6 }])
})

test('a hex run of an undefined length paints nothing', () => {
    assert.deepEqual(paint('a #12345'), [])
    assert.deepEqual(paint('a #1234567'), [])
})

// The run of hex digits is greedy, so this is one candidate of eight characters
// rather than #abcdef with two letters left over.
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: FAIL. `#f8c` paints nothing because `HEX_LENGTHS` holds only `6`, and `word#ff0000`, `##ff0000` and `#face`
each paint when they should not.

- [ ] **Step 3: Write the implementation**

In `color-highlight.js`, widen the accepted lengths and expand the short form:

```javascript
    const HEX_LENGTHS = new Set([3, 6])

    // Returns { a, b, g, r } with r, g and b in 0..255 and a in 0..1, or
    // undefined. Everything downstream therefore holds a real colour.
    const parseColor = source => {
        const digits = source.slice(1)
        if (!HEX_LENGTHS.has(digits.length)) return undefined
        // The short form doubles each digit: #f8c is #ff88cc.
        const full = digits.length === 3 ? [...digits].map(digit => digit + digit).join('') : digits
        const channel = index => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16)
        return { a: 1, b: channel(2), g: channel(1), r: channel(0) }
    }
```

Add `opensLine` above `findColors`, and the two rejection rules inside it:

```javascript
    // Everything before `index` is whitespace, so the token opens the line. In
    // Markdown that position belongs to a heading or an anchor far more often
    // than to a colour, and nothing in the text can tell them apart. A real
    // colour literal follows a property name, a word, or a list marker.
    const opensLine = (line, index) => line.slice(0, index).trim() === ''

    const findColors = line => {
        const found = []
        CANDIDATE.lastIndex = 0
        for (let match = CANDIDATE.exec(line); match !== null; match = CANDIDATE.exec(line)) {
            const source = match[0]
            const index = match.index
            // A lookbehind in the pattern would be shorter, but the WebView that
            // runs this script is not guaranteed to have one.
            if (opensLine(line, index) || /[\w#]/.test(line[index - 1] ?? '')) continue
            const color = parseColor(source)
            if (color !== undefined) found.push({ color, from: index, to: index + source.length })
        }
        return found
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: PASS, 13 tests.

- [ ] **Step 5: Lint, format, and commit**

```bash
npm run lint && npm run format && npm test
git add extensions/color-highlight/
git commit -m "feat(color-highlight): accept three-digit hex, reject headings and word-joined tokens"
```

---

## Task 3: The functional forms, opaque

`rgb()` and `rgba()` in both syntaxes, with the argument splitting and the number parsing that `hsl()` will reuse.
Alpha is parsed and required to be valid, but is not yet honoured; Task 4 does that.

**Files:**

- Modify: `extensions/color-highlight/color-highlight.js`
- Test: `extensions/color-highlight/test/color-highlight.test.mjs`

**Interfaces:**

- Consumes: `paint`, `style` from Task 1.
- Produces: `parseNumber(token) -> {isPercent, value} | undefined`, `parseArgs(inner) -> {alpha, channels} | undefined`,
  `clamp(value, low, high)`, `rgbChannel(token) -> number | undefined`. `parseColor` now dispatches on the shape of its
  argument.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/color-highlight/test/color-highlight.test.mjs`:

```javascript
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
    assert.deepEqual(paint('a rgb(calc(1px), 0, 0)'), [])
})

test('a word ending in rgb is not a functional form', () => {
    assert.deepEqual(paint('a srgb(255, 0, 0)'), [])
})

test('uppercase RGB paints', () => {
    assert.equal(paint('a RGB(255, 0, 0)')[0].style, style('rgba(255, 0, 0, 1)', '#000000'))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: FAIL. `CANDIDATE` matches only hex, so every `rgb()` test finds no decoration.

- [ ] **Step 3: Write the implementation**

Widen `CANDIDATE`. The `\b` stops `srgb(` from matching, and `[^()\n]*` keeps a candidate inside one line and refuses a
nested parenthesis such as `calc()`:

```javascript
    const CANDIDATE = /#[0-9a-f]+|\b(?:rgb|hsl)a?\([^()\n]*\)/gi
```

Add the number and argument helpers above `parseColor`:

```javascript
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

    // One argument of a functional form: an optional sign, digits with an
    // optional decimal point, and an optional percent. Anything else — `none`, a
    // unit this parser does not know, a nested call — is not a number here, and
    // a token that is not a colour is left alone rather than painted wrongly.
    const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(%?)$/

    const parseNumber = token => {
        const match = NUMBER.exec(token)
        if (match === null) return undefined
        return { isPercent: match[1] === '%', value: Number.parseFloat(token) }
    }

    // Split the inside of a functional form into three channels and an alpha.
    // The alpha comes after a slash in the current syntax and as a fourth comma
    // argument in the old one, and both are accepted.
    const parseArgs = inner => {
        const slash = inner.indexOf('/')
        const head = slash === -1 ? inner : inner.slice(0, slash)
        let alpha = slash === -1 ? undefined : inner.slice(slash + 1).trim()

        const parts = (head.includes(',') ? head.split(',') : head.trim().split(/\s+/)).map(part => part.trim())
        if (parts.length === 4 && alpha === undefined) alpha = parts.pop()

        if (parts.length !== 3 || parts.some(part => part === '') || alpha === '') return undefined
        return { alpha, channels: parts }
    }

    const parseAlpha = token => {
        if (token === undefined) return 1
        const number = parseNumber(token)
        if (number === undefined) return undefined
        return clamp(number.isPercent ? number.value / 100 : number.value, 0, 1)
    }

    // A percentage is of 255; a plain number is already 0..255.
    const rgbChannel = token => {
        const number = parseNumber(token)
        if (number === undefined) return undefined
        return Math.round(clamp(number.isPercent ? (number.value / 100) * 255 : number.value, 0, 255))
    }
```

Split `parseColor` into a hex half and a functional half. A permissive reading is chosen on purpose:
`rgb(255, 0, 0 / 50%)` mixes two syntaxes and is not valid CSS, and this parser paints it. Refusing it would only ever
decline something the author plainly meant as a colour.

```javascript
    const parseHex = source => {
        const digits = source.slice(1)
        if (!HEX_LENGTHS.has(digits.length)) return undefined
        // The short form doubles each digit: #f8c is #ff88cc.
        const full = digits.length === 3 ? [...digits].map(digit => digit + digit).join('') : digits
        const channel = index => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16)
        return { a: 1, b: channel(2), g: channel(1), r: channel(0) }
    }

    // Returns { a, b, g, r } with r, g and b in 0..255 and a in 0..1, or
    // undefined. Everything downstream therefore holds a real colour.
    const parseColor = source => {
        if (source.startsWith('#')) return parseHex(source)

        const open = source.indexOf('(')
        if (open === -1 || !source.endsWith(')')) return undefined
        const form = source.slice(0, open).toLowerCase()

        const args = parseArgs(source.slice(open + 1, -1))
        if (args === undefined) return undefined
        const a = parseAlpha(args.alpha)
        if (a === undefined) return undefined

        if (form !== 'rgb' && form !== 'rgba') return undefined
        const [r, g, b] = args.channels.map(rgbChannel)
        if (r === undefined || g === undefined || b === undefined) return undefined
        return { a: 1, b, g, r }
    }
```

The two blocks above replace the whole of the old `parseColor`. `HEX_LENGTHS` stays where it is; `parseHex` is now its
only reader.

The `form` test is written as a rejection rather than as a fall-through because Task 4 feeds `parseColor` the value of a
computed CSS property, which can be a function this extension knows nothing about.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: PASS, 21 tests.

- [ ] **Step 5: Lint, format, and commit**

```bash
npm run lint && npm run format && npm test
git add extensions/color-highlight/
git commit -m "feat(color-highlight): paint rgb() in both syntaxes"
```

---

## Task 4: Alpha, and the background behind it

Four- and eight-digit hex, the alpha argument of a functional form, and the compositing that the contrast choice needs.
A transparent token shows the editor through it, so the choice of black or white has to know what is behind.

**Files:**

- Modify: `extensions/color-highlight/color-highlight.js`
- Test: `extensions/color-highlight/test/color-highlight.test.mjs`

**Interfaces:**

- Consumes: `paint`, `style`, `load`, `viewOf`, `decorationsOf` from Task 1; `parseColor` from Task 3.
- Produces: `over(color, background)`, `editorBackground(view) -> {a, b, g, r}`, `WHITE`. `contrastColor` now uses its
  `background` parameter, and `buildDecorations` sources the background from the view.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/color-highlight/test/color-highlight.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: FAIL. `#f00c` paints nothing, `rgba()` paints at alpha `1`, and both background cases choose the same text
colour because `contrastColor` ignores its `background`.

- [ ] **Step 3: Write the implementation**

Widen the hex lengths, and carry the alpha through both halves of the parser. The alpha is rounded to three decimals in
one place, so every style string the extension writes is short and every test can name one:

```javascript
    const HEX_LENGTHS = new Set([3, 4, 6, 8])

    const roundAlpha = alpha => Math.round(alpha * 1000) / 1000

    const parseHex = source => {
        const digits = source.slice(1)
        if (!HEX_LENGTHS.has(digits.length)) return undefined
        // The short forms double each digit: #f8c is #ff88cc, #f8c4 is #ff88cc44.
        const full = digits.length <= 4 ? [...digits].map(digit => digit + digit).join('') : digits
        const channel = index => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16)
        return { a: full.length === 8 ? roundAlpha(channel(3) / 255) : 1, b: channel(2), g: channel(1), r: channel(0) }
    }
```

In `parseAlpha`, round the result:

```javascript
        return roundAlpha(clamp(number.isPercent ? number.value / 100 : number.value, 0, 1))
```

In `parseColor`, return the parsed alpha instead of `1`:

```javascript
        return { a, b, g, r }
```

Replace the contrast section with the compositing form:

```javascript
    // What the eye sees: a transparent colour laid over what is behind it.
    const over = (color, background) =>
        color.a >= 1
            ? color
            : {
                  b: color.b * color.a + background.b * (1 - color.a),
                  g: color.g * color.a + background.g * (1 - color.a),
                  r: color.r * color.a + background.r * (1 - color.a),
              }

    const contrastColor = (color, background) => (luminance(over(color, background)) > THRESHOLD ? '#000000' : '#ffffff')
```

`mark` now needs the background too, and passes it through:

```javascript
    const mark = (color, background) =>
        Decoration.mark({
            attributes: {
                style:
                    `background-color: rgba(${color.r}, ${color.g}, ${color.b}, ${color.a}); ` +
                    `color: ${contrastColor(color, background)}; border-radius: 3px;`,
            },
        })
```

Add the background reader above `buildDecorations`. It reuses `parseColor`, because `getComputedStyle` answers in the
old comma syntax, which the parser already reads:

```javascript
    const WHITE = { a: 1, b: 255, g: 255, r: 255 }

    // The text of a transparent token sits on the editor, so the choice of black
    // or white has to know what is behind it. `.cm-content` is usually
    // transparent and the colour lives on an ancestor, so walk up until one of
    // them answers with something opaque.
    const editorBackground = view => {
        for (let element = view.contentDOM; element; element = element.parentElement) {
            const color = parseColor(window.getComputedStyle(element).backgroundColor ?? '')
            if (color !== undefined && color.a > 0) return color
        }
        return WHITE
    }
```

In `buildDecorations`, read the background from the view and hand it to each `mark`. It is read one time for each build,
not one time for each colour:

```javascript
    const buildDecorations = view => {
        const builder = new RangeSetBuilder()
        const background = editorBackground(view)

        for (const { from, to } of view.visibleRanges) {
            let pos = from
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos)
                for (const found of findColors(line.text))
                    builder.add(line.from + found.from, line.from + found.to, mark(found.color, background))
                pos = line.to + 1
            }
        }
        return builder.finish()
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: PASS, 30 tests.

- [ ] **Step 5: Lint, format, and commit**

```bash
npm run lint && npm run format && npm test
git add extensions/color-highlight/
git commit -m "feat(color-highlight): honour alpha and composite it over the editor"
```

---

## Task 5: `hsl()` and `hsla()`

**Files:**

- Modify: `extensions/color-highlight/color-highlight.js`
- Test: `extensions/color-highlight/test/color-highlight.test.mjs`

**Interfaces:**

- Consumes: `paint`, `style` from Task 1; `parseArgs`, `parseNumber`, `clamp` from Task 3.
- Produces: `hslToRgb(h, s, l) -> {b, g, r}`, `parseHue(token)`.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/color-highlight/test/color-highlight.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: FAIL. `parseColor` returns `undefined` for every form that is not `rgb` or `rgba`, so no `hsl()` paints.

- [ ] **Step 3: Write the implementation**

Add the conversion and the hue reader above `parseColor`:

```javascript
    // The chroma form of the CSS conversion. `h` is degrees, `s` and `l` are 0..1.
    const hslToRgb = (h, s, l) => {
        const chroma = (1 - Math.abs(2 * l - 1)) * s
        const sector = (((h % 360) + 360) % 360) / 60
        const second = chroma * (1 - Math.abs((sector % 2) - 1))
        const base = l - chroma / 2

        const [r, g, b] =
            sector < 1
                ? [chroma, second, 0]
                : sector < 2
                  ? [second, chroma, 0]
                  : sector < 3
                    ? [0, chroma, second]
                    : sector < 4
                      ? [0, second, chroma]
                      : sector < 5
                        ? [second, 0, chroma]
                        : [chroma, 0, second]

        return { b: Math.round((b + base) * 255), g: Math.round((g + base) * 255), r: Math.round((r + base) * 255) }
    }

    // `deg` is the only unit accepted. `rad`, `grad` and `turn` are rare in a
    // hand-written colour, and refusing them leaves the token alone rather than
    // painting it as some other colour.
    const parseHue = token => parseNumber(token.replace(/deg$/i, ''))
```

In `parseColor`, replace the single rejection with a dispatch on the form:

```javascript
        if (form === 'rgb' || form === 'rgba') {
            const [r, g, b] = args.channels.map(rgbChannel)
            if (r === undefined || g === undefined || b === undefined) return undefined
            return { a, b, g, r }
        }

        if (form !== 'hsl' && form !== 'hsla') return undefined
        const hue = parseHue(args.channels[0])
        const saturation = parseNumber(args.channels[1])
        const lightness = parseNumber(args.channels[2])
        if (hue === undefined || saturation === undefined || lightness === undefined) return undefined
        // Saturation and lightness are 0..100, whether or not the percent is written.
        return { a, ...hslToRgb(hue.value, clamp(saturation.value, 0, 100) / 100, clamp(lightness.value, 0, 100) / 100) }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: PASS, 36 tests.

- [ ] **Step 5: Lint, format, and commit**

```bash
npm run lint && npm run format && npm test
git add extensions/color-highlight/
git commit -m "feat(color-highlight): paint hsl() and hsla()"
```

---

## Task 6: The menu item and the repaint

An item in the Extensions menu turns the painting on and off, and the flip takes effect at once. The state lives in
memory only; Task 7 writes it to disk.

**Files:**

- Modify: `extensions/color-highlight/color-highlight.js`
- Test: `extensions/color-highlight/test/color-highlight.test.mjs`

**Interfaces:**

- Consumes: `load`, `viewOf`, `decorationsOf` from Task 1.
- Produces: module state `enabled`, the `repaint` `StateEffect`, and `toggle()`. `load` gains a `userSettings` option
  that is already in the Task 1 harness.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/color-highlight/test/color-highlight.test.mjs`:

```javascript
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
    loaded.MarkEdit.editorView = { dispatched: [], dispatch: spec => loaded.MarkEdit.editorView.dispatched.push(spec) }

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: FAIL. `load().menuItem` is `null`, so the first assertion throws.

- [ ] **Step 3: Write the implementation**

Add `StateEffect` to the `@codemirror/state` import:

```javascript
    const { RangeSetBuilder, StateEffect } = require('@codemirror/state')
```

Add the constants and the module state below the imports:

```javascript
    const MENU_TITLE = 'Highlight Colors'
    const SETTINGS_KEY = 'extension.colorHighlight'

    let enabled = MarkEdit.userSettings?.[SETTINGS_KEY]?.enabled ?? true
```

Guard `buildDecorations` at the top, before it does any work:

```javascript
    const buildDecorations = view => {
        const builder = new RangeSetBuilder()
        if (!enabled) return builder.finish()

        const background = editorBackground(view)
```

Define the effect above the plugin, and rebuild on it. It carries no data; it exists to make the update happen, because
a `ViewPlugin` repaints only when it sees one:

```javascript
    const repaint = StateEffect.define()

    const rebuilds = update =>
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some(transaction => transaction.effects.some(effect => effect.is(repaint)))
```

Change the plugin's `update` to use it:

```javascript
                update(update) {
                    if (rebuilds(update)) this.decorations = buildDecorations(update.view)
                }
```

Register the menu item at the end of the IIFE. A `StateField` holding the same boolean was considered and rejected: it
would be a second place where "is this on?" lives, and the menu would still need the module value for its checkmark:

```javascript
    const toggle = () => {
        enabled = !enabled
        MarkEdit.editorView?.dispatch({ effects: repaint.of(null) })
    }

    MarkEdit.addMainMenuItem({
        action: toggle,
        state: () => ({ isSelected: enabled }),
        title: MENU_TITLE,
    })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: PASS, 44 tests.

- [ ] **Step 5: Lint, format, and commit**

```bash
npm run lint && npm run format && npm test
git add extensions/color-highlight/
git commit -m "feat(color-highlight): add the Extensions menu toggle"
```

---

## Task 7: Persisting the toggle

The read-merge-write of `copy-on-select.js`, with its refusals. This is the second occurrence of the pattern and it is
copied rather than shared: each extension is a single drop-in file that MarkEdit loads on its own, so there is nowhere
for shared code to live, and the installer copies files, not module graphs. The house rule extracts on the third.

**Files:**

- Modify: `extensions/color-highlight/color-highlight.js`
- Modify: `extensions/color-highlight/test/color-highlight.test.mjs` (the `load` helper gains file stubs)
- Reference: `extensions/copy-on-select/copy-on-select.js` — the pattern to copy

**Interfaces:**

- Consumes: `SETTINGS_KEY`, `MENU_TITLE`, `toggle` from Task 6.
- Produces: `persistEnabled()`, `alertOnce(message)`, `isPlainObject(value)`, `parseSettings(raw)`,
  `settingsAbsent(directory)`.

- [ ] **Step 1: Extend the harness and write the failing tests**

In `load`, add the file options and the file APIs. Replace the `load` signature and the `MarkEdit` object with:

```javascript
function load({ createFileResult = true, files = {}, getFileContentError, listFilesError, listing, userSettings = {} } = {}) {
    const calls = { alerts: [], created: [], directoryPaths: [], listed: [] }
    const extensions = []
    let menuItem = null

    // listFiles defaults to a listing of the stubbed files, so an absent file in
    // `files` is genuinely absent unless a test says otherwise.
    const defaultListing = () => Object.keys(files)

    const MarkEdit = {
        addExtension: extension => {
            extensions.push(extension)
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
```

Append the tests:

```javascript
// The toggle writes the file in a promise that the caller does not await.
const settled = () => new Promise(resolve => setImmediate(resolve))

test('a toggle writes settings.json and keeps the unrelated keys', async () => {
    const files = { '/docs/settings.json': JSON.stringify({ 'editor.fontSize': 14, 'extension.copyOnSelect': { enabled: true } }) }
    const { calls, menuItem } = load({ files })
    menuItem.action()
    await settled()

    assert.equal(calls.created.length, 1)
    assert.equal(calls.created[0].path, '/docs/settings.json')
    assert.equal(calls.created[0].overwrites, true)
    const written = JSON.parse(calls.created[0].string)
    assert.deepEqual(written['extension.colorHighlight'], { enabled: false })
    assert.equal(written['editor.fontSize'], 14)
    assert.deepEqual(written['extension.copyOnSelect'], { enabled: true })
})

test('a toggle keeps the unrelated keys inside its own settings object', async () => {
    const files = { '/docs/settings.json': JSON.stringify({ 'extension.colorHighlight': { enabled: true, note: 'keep me' } }) }
    const { calls, menuItem } = load({ files })
    menuItem.action()
    await settled()
    assert.deepEqual(JSON.parse(calls.created[0].string)['extension.colorHighlight'], { enabled: false, note: 'keep me' })
})

test('an absent settings.json is written as a new file', async () => {
    const { calls, menuItem } = load()
    menuItem.action()
    await settled()
    assert.deepEqual(JSON.parse(calls.created[0].string), { 'extension.colorHighlight': { enabled: false } })
})

test('the settings path comes from the documents directory', async () => {
    const { calls, menuItem } = load()
    menuItem.action()
    await settled()
    assert.deepEqual(calls.directoryPaths, ['documents'])
    assert.deepEqual(calls.listed, ['/docs'])
    assert.equal(calls.created[0].path, '/docs/settings.json')
})

test('a malformed settings.json alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ files: { '/docs/settings.json': '{ this is not json' } })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [], 'an unparseable file must never be overwritten')
    assert.equal(calls.alerts.length, 1)
    assert.match(calls.alerts[0].message, /settings\.json/)
    assert.equal(calls.alerts[0].title, 'Highlight Colors')
})

test('a settings.json holding a non-object alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ files: { '/docs/settings.json': '[1, 2, 3]' } })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [])
    assert.equal(calls.alerts.length, 1)
})

// getFileContent gives undefined when the read fails, not when the file is
// absent. A write then replaces every MarkEdit setting with this one key.
test('an unreadable settings.json that a listing shows to be present alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ listing: ['settings.json'] })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [], 'a file that can be listed must never be replaced')
    assert.equal(calls.alerts.length, 1)
})

test('a failed listing alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ listing: false })
    menuItem.action()
    await settled()
    assert.deepEqual(calls.created, [], 'absence that cannot be proved must never be assumed')
    assert.equal(calls.alerts.length, 1)
})

test('a rejecting file API alerts once and does not throw', async () => {
    const { calls, menuItem } = load({ getFileContentError: new Error('disk error') })
    assert.doesNotThrow(() => menuItem.action())
    await settled()
    assert.deepEqual(calls.created, [])
    assert.equal(calls.alerts.length, 1)
})

test('a rejecting listFiles alerts and writes nothing', async () => {
    const { calls, menuItem } = load({ listFilesError: new Error('no such directory') })
    assert.doesNotThrow(() => menuItem.action())
    await settled()
    assert.deepEqual(calls.created, [])
    assert.equal(calls.alerts.length, 1)
})

test('a failed write alerts and leaves the toggle working in memory', async () => {
    const { calls, menuItem } = load({ createFileResult: false })
    menuItem.action()
    await settled()
    assert.equal(calls.alerts.length, 1)
    assert.equal(menuItem.state().isSelected, false)
})

test('a broken settings.json alerts one time for each session', async () => {
    const { calls, menuItem } = load({ files: { '/docs/settings.json': '{ nope' } })
    menuItem.action()
    await settled()
    menuItem.action()
    await settled()
    assert.equal(calls.alerts.length, 1)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: FAIL. `calls.created` is empty in every case, because `toggle` writes nothing.

- [ ] **Step 3: Write the implementation**

Add the messages below `SETTINGS_KEY`:

```javascript
    const SETTINGS_FILE = 'settings.json'

    const PARSE_FAILURE =
        `${SETTINGS_FILE} could not be read, so the setting was not saved. ` +
        'Correct the file, or the toggle will reset when you quit MarkEdit.'
    const READ_FAILURE = `${SETTINGS_FILE} could not be opened, so the setting was not saved. The toggle will reset when you quit MarkEdit.`
    const WRITE_FAILURE = `${SETTINGS_FILE} could not be written, so the setting was not saved. The toggle will reset when you quit MarkEdit.`
```

Add the module flag next to `enabled`:

```javascript
    // One alert for each session. A user who toggles the item against a broken
    // file does not need one alert for each attempt.
    let alerted = false
```

Add the persistence block above `toggle`:

```javascript
    // typeof null is 'object', so the null test is not redundant. JSON.parse is
    // what produces null here; the rest of the file uses undefined.
    const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

    const alertOnce = message => {
        if (alerted) return
        alerted = true
        MarkEdit.showAlert({ message, title: MENU_TITLE })
    }

    const parseSettings = raw => {
        try {
            return JSON.parse(raw)
        } catch {
            return undefined
        }
    }

    // Proof that the file is not there, which only a successful listing gives. A
    // listing that fails, or that holds the file, proves nothing.
    const settingsAbsent = async directory => {
        const listing = await MarkEdit.listFiles(directory)
        return Array.isArray(listing) && !listing.some(entry => entry === SETTINGS_FILE || entry.endsWith(`/${SETTINGS_FILE}`))
    }

    // Read, merge one key, write back, so every unrelated setting survives. Each
    // half has its own try/catch: a rejected API call is a failure of that half,
    // and it must alert with that message instead of escaping as an unhandled
    // rejection.
    const persistEnabled = async () => {
        let path
        let settings = {}

        try {
            const directory = MarkEdit.getDirectoryPath('documents')
            path = `${directory}/${SETTINGS_FILE}`
            const raw = await MarkEdit.getFileContent(path)

            if (typeof raw !== 'string') {
                // The API returns undefined when the read fails, not when the file is
                // absent. A write now could replace a real settings.json with this one
                // key, so refuse until a listing proves that the file is not there.
                if (!(await settingsAbsent(directory))) {
                    alertOnce(READ_FAILURE)
                    return
                }
            } else if (raw.trim() !== '') {
                const parsed = parseSettings(raw)
                if (!isPlainObject(parsed)) {
                    // Writing now would replace every MarkEdit setting with this one key.
                    alertOnce(PARSE_FAILURE)
                    return
                }
                settings = parsed
            }
        } catch {
            alertOnce(READ_FAILURE)
            return
        }

        try {
            const current = isPlainObject(settings[SETTINGS_KEY]) ? settings[SETTINGS_KEY] : {}
            const merged = { ...settings, [SETTINGS_KEY]: { ...current, enabled } }
            const written = await MarkEdit.createFile({ overwrites: true, path, string: JSON.stringify(merged, null, 2) })
            if (!written) alertOnce(WRITE_FAILURE)
        } catch {
            alertOnce(WRITE_FAILURE)
        }
    }
```

Start the write from `toggle`:

```javascript
    const toggle = () => {
        enabled = !enabled
        MarkEdit.editorView?.dispatch({ effects: repaint.of(null) })
        void persistEnabled()
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test extensions/color-highlight/test/color-highlight.test.mjs`

Expected: PASS, 56 tests. Then run the whole suite: `npm test`.

- [ ] **Step 5: Lint, format, and commit**

```bash
npm run lint && npm run format && npm test
git add extensions/color-highlight/
git commit -m "feat(color-highlight): persist the toggle to settings.json"
```

---

## Task 8: Documentation and the version

`test/repo.test.mjs` asserts that every extension directory has a `README.md`, that the root README links it, and that
the changelog holds a heading for the version in `package.json`. This task is what makes those pass.

**Files:**

- Create: `extensions/color-highlight/README.md`
- Modify: `README.md` — the table of extensions
- Modify: `CHANGELOG.md` — a `1.2.0` entry
- Modify: `package.json` — version `1.2.0`

**Interfaces:**

- Consumes: the finished extension from Tasks 1 to 7.
- Produces: nothing that later code reads.

- [ ] **Step 1: Run the repository tests to see them fail**

Run: `npm test`

Expected: FAIL. `test/repo.test.mjs` reports that `color-highlight` should have a `README.md`.

- [ ] **Step 2: Write the extension README**

Create `extensions/color-highlight/README.md`:

````markdown
# Color Highlight

Paints every colour in the editor with the colour it names, and sets the text of the token to black or white,
whichever reads better on it.

| Kind | Examples |
| --- | --- |
| Hex, 3 or 6 digits | `#f00`, `#ff0000` |
| Hex with alpha, 4 or 8 digits | `#f00c`, `#ff0000cc` |
| `rgb()` and `rgba()` | `rgb(255, 0, 0)`, `rgb(255 0 0 / 50%)` |
| `hsl()` and `hsla()` | `hsl(0, 100%, 50%)`, `hsl(0deg 100% 50% / 50%)` |

Both the comma syntax and the space syntax are read, in the channels and in the alpha. A token with alpha paints at
that alpha, so the editor shows through it.

Every part of the document is painted: a colour in a sentence, in a code span, and in a fenced block all look alike.

## Install

```bash
./install.sh color-highlight
```

Then restart MarkEdit.

## Settings

The item **Highlight Colors** in the Extensions menu turns the painting on and off. The choice is written to
`settings.json` under `extension.colorHighlight`, so it survives a restart. The extension is on by default.

```json
{
    "extension.colorHighlight": { "enabled": true }
}
```

## What is not painted

A hex token that opens a line paints nothing, ignoring indentation. A line that starts with `#` is a Markdown heading,
and a run of hex digits in that position is far more often a heading or an anchor than a colour. A real colour follows
a property name, a word, or a list marker. The cost is a list of bare colours, one to a line, which paints nothing.

A hex token joined to a word, such as `page#abc`, paints nothing, and neither does a run of hex digits at a length CSS
does not define, such as `#12345`.

The rule about the start of a line is for hex only. `rgb(255, 0, 0)` is not heading-shaped and paints anywhere.

Named colours such as `tomato`, and the modern spaces `lab()` and `oklch()`, are not painted.

## Known limit

The colour of the editor background is read when the paint is built. It matters only for a token that has alpha, since
the editor shows through such a token. After a theme change, the text colour of a transparent token keeps its old
choice until the next edit or the next scroll. An opaque token is not affected: its text sits on its own colour.
````

- [ ] **Step 3: Add the row to the root README**

In `README.md`, add a row to the table of extensions, after the `copy-on-select` row:

```markdown
| [color-highlight](extensions/color-highlight/) | Paints hex, `rgb()` and `hsl()` colours with the colour they name. |
```

- [ ] **Step 4: Add the changelog entry and bump the version**

In `CHANGELOG.md`, add a dated `1.2.0` section between `## [Unreleased]` and `## [1.1.0] - 2026-08-06`, matching the
shape of the entries already there:

```markdown
## [1.2.0] - 2026-08-30

### Added

- `extensions/color-highlight`: paints hex, `rgb()` and `hsl()` colour tokens with the colour they name, and sets the
  text of the token to black or white by WCAG relative luminance. A hex token that opens a line is left alone, because
  that position belongs to a Markdown heading. A menu item turns the extension on and off, and the state is kept in the
  `extension.colorHighlight` key of `settings.json`.
```

In `package.json`, set `"version": "1.2.0"`.

- [ ] **Step 5: Run the whole suite to verify it passes**

Run: `npm test`

Expected: PASS. `test/repo.test.mjs` finds the extension README, the root README row, and the `1.2.0` heading.

- [ ] **Step 6: Lint, format, and commit**

```bash
npm run lint && npm run format && npm test
git add extensions/color-highlight/README.md README.md CHANGELOG.md package.json
git commit -m "docs(color-highlight): document the extension and release 1.2.0"
```

---

## Manual verification

The tests run against stubs. Before calling the work done, install into the real app and look at it:

```bash
./install.sh color-highlight
```

Restart MarkEdit, open a document holding the examples from the extension README, and check:

1. Each token is painted, and its text is readable on it.
1. A token inside a fenced `css` block is painted, so the inline style beats the syntax-highlighting class.
1. The characters stay in their columns; the paint adds no width.
1. **Highlight Colors** in the Extensions menu shows a checkmark, and unticking it clears the paint at once.
1. The choice survives a quit and a relaunch.
1. Scrolling a long document paints the newly visible lines and stays responsive.
