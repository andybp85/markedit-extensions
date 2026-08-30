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
    // lengths it does not recognise.
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
