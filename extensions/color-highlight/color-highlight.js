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
    // parseColor is what decides. The run of hex digits is greedy, so a
    // candidate is never a prefix cut out of the middle of a longer run — it
    // always takes the whole run, however long, and parseColor rejects the
    // lengths it does not recognise. `\b` before the functional forms stops
    // `srgb(` from matching, and `[^()\n]*` keeps a candidate inside one line
    // and refuses a nested parenthesis such as `calc()`.
    const CANDIDATE = /#[0-9a-f]+|\b(?:rgb|hsl)a?\([^()\n]*\)/gi

    const HEX_LENGTHS = new Set([3, 6])

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

    // Everything before `index` is whitespace, so the token opens the line. In
    // Markdown that position belongs to a heading or an anchor far more often
    // than to a colour, and nothing in the text can tell them apart. A real
    // colour literal follows a property name, a word, or a list marker.
    const opensLine = (line, index) => line.slice(0, index).trim() === ''

    // A lookbehind in CANDIDATE would be shorter than reading the neighbour out
    // of the line, but the WebView that runs this script is not guaranteed to
    // have one. A missing neighbour is the start or the end of the line.
    const isWordish = character => /[\w#]/.test(character ?? '')

    // What disqualifies a hex candidate on its left: it opens the line, or it
    // continues a word. Both are `#` phenomena, so neither is asked of a
    // functional form — one that opens a line is a real colour, not a heading.
    const leadRefusesHex = (line, index) => opensLine(line, index) || isWordish(line[index - 1])

    // A sweep runs over one line, which is what makes the rules that reject a
    // candidate expressible at all: neither "first on the line" nor "preceded by
    // a word character" means anything against a slice of arbitrary text.
    const findColors = line => {
        const found = []
        CANDIDATE.lastIndex = 0
        for (let match = CANDIDATE.exec(line); match !== null; match = CANDIDATE.exec(line)) {
            const source = match[0]
            const index = match.index
            const isHex = source[0] === '#'
            if (isHex && leadRefusesHex(line, index)) continue
            // The trailing rule is asked of every candidate, hex or functional:
            // `\b` in CANDIDATE anchors only the left of `rgb`/`hsl` and says
            // nothing about what follows the closing parenthesis, and a colour
            // token glued to trailing identifier text is not a colour literal in
            // either form. A hex match ends on its own — CANDIDATE matches only
            // hex digits, so #abcdefgh matches #abcdef and stops at "g" rather
            // than absorbing it — and that is exactly the case this rejects: the
            // digit run continues a word instead of standing on its own.
            if (isWordish(line[index + source.length])) continue
            const color = parseColor(source)
            if (color !== undefined) found.push({ color, from: index, to: index + source.length })
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
                for (const found of findColors(line.text)) builder.add(line.from + found.from, line.from + found.to, mark(found.color))
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
