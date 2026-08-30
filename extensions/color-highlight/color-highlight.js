/*
 * MarkEdit Color Highlight
 * Paints hex, rgb() and hsl() colour literals with the colour they name.
 * Drop this file into MarkEdit's `scripts/` directory. The Extensions menu
 * carries an item that turns the painting on and off.
 *
 * API: https://github.com/MarkEdit-app/MarkEdit/wiki/Customization#markedit-api
 */
;(() => {
    'use strict'

    // In MarkEdit's scripts/ runtime the API and the CodeMirror modules are
    // CommonJS modules, not globals.
    const { MarkEdit } = require('markedit-api')
    const { Decoration, ViewPlugin } = require('@codemirror/view')
    const { RangeSetBuilder, StateEffect } = require('@codemirror/state')

    const MENU_TITLE = 'Highlight Colors'
    const SETTINGS_KEY = 'extension.colorHighlight'
    const SETTINGS_FILE = 'settings.json'

    const PARSE_FAILURE =
        `${SETTINGS_FILE} could not be read, so the setting was not saved. ` +
        'Correct the file, or the toggle will reset when you quit MarkEdit.'
    const READ_FAILURE = `${SETTINGS_FILE} could not be opened, so the setting was not saved. The toggle will reset when you quit MarkEdit.`
    const WRITE_FAILURE = `${SETTINGS_FILE} could not be written, so the setting was not saved. The toggle will reset when you quit MarkEdit.`

    // Painting is on unless the settings say otherwise, and the setting is read
    // one time, at load. The menu item below moves this from then on, writing
    // the new value back to settings.json so it survives past this session.
    let enabled = MarkEdit.userSettings?.[SETTINGS_KEY]?.enabled ?? true

    // One alert for each session. A user who toggles the item against a broken
    // file does not need one alert for each attempt.
    let alerted = false

    // A candidate is a shape that could be a colour. It is deliberately loose:
    // parseColor is what decides. The run of hex digits is greedy, so a
    // candidate is never a prefix cut out of the middle of a longer run — it
    // always takes the whole run, however long, and parseColor rejects the
    // lengths it does not recognise. `\b` before the functional forms stops
    // `srgb(` from matching, and `[^()\n]*` keeps a candidate inside one line
    // and refuses a nested parenthesis such as `calc()`.
    const CANDIDATE = /#[0-9a-f]+|\b(?:rgb|hsl)a?\([^()\n]*\)/gi

    const HEX_LENGTHS = new Set([3, 4, 6, 8])

    const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

    // Every alpha computed from a parsed number passes through here, so the
    // number in the CSS is short: 0x80 / 255 is 0.5019607843137255 and becomes
    // 0.502. The default for a colour that states no alpha is a bare 1, written
    // by parseAlpha and parseHex without this call — 1 has nothing to round.
    const roundAlpha = alpha => Math.round(alpha * 1000) / 1000

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
        return roundAlpha(clamp(number.isPercent ? number.value / 100 : number.value, 0, 1))
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
        // The short forms double each digit: #f8c is #ff88cc, #f8c4 is #ff88cc44.
        const full = digits.length <= 4 ? [...digits].map(digit => digit + digit).join('') : digits
        const channel = index => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16)
        return { a: full.length === 8 ? roundAlpha(channel(3) / 255) : 1, b: channel(2), g: channel(1), r: channel(0) }
    }

    // The chroma form of the CSS conversion. `h` is degrees, `s` and `l` are
    // 0..1. `chroma` is the spread between the largest and the smallest
    // channel, `sector` places the hue on one of the six ramps between the
    // primaries and the secondaries, and `second` is the middle channel, which
    // rises or falls across the sector the hue landed on. Adding `base` to all
    // three puts the midpoint of the largest and the smallest back at `l`.
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

    // A hue is degrees, written bare or with `deg`. Stripping that suffix leaves
    // a bare number; any other angle unit stays in the token and NUMBER refuses
    // it, so `rad`, `grad` and `turn` — rare in a hand-written colour — leave
    // the token unpainted rather than painted as some other colour. NUMBER does
    // accept a trailing percent, because the other two hsl() arguments are
    // percentages; a hue is not one in any CSS syntax, so it is refused here.
    const parseHue = token => {
        const hue = parseNumber(token.replace(/deg$/i, ''))
        return hue?.isPercent ? undefined : hue
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
        // Saturation and lightness are read as 0..100 whether or not the percent
        // is written, so `hsl(0 100 50)` is the colour `hsl(0, 100%, 50%)` names.
        return { a, ...hslToRgb(hue.value, clamp(saturation.value, 0, 100) / 100, clamp(lightness.value, 0, 100) / 100) }
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

    // What the eye sees: a transparent colour laid over what is behind it. An
    // opaque colour is already what the eye sees, so that branch skips the
    // arithmetic and copies the three channels. Both branches return the same
    // shape and neither carries an alpha: the return is a final composited
    // value, not a colour still waiting to be laid over something.
    const over = (color, background) =>
        color.a >= 1
            ? { b: color.b, g: color.g, r: color.r }
            : {
                  b: color.b * color.a + background.b * (1 - color.a),
                  g: color.g * color.a + background.g * (1 - color.a),
                  r: color.r * color.a + background.r * (1 - color.a),
              }

    const contrastColor = (color, background) => (luminance(over(color, background)) > THRESHOLD ? '#000000' : '#ffffff')

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

    const mark = (color, background) =>
        Decoration.mark({
            attributes: {
                style:
                    `background-color: rgba(${color.r}, ${color.g}, ${color.b}, ${color.a}); ` +
                    `color: ${contrastColor(color, background)}; border-radius: 3px;`,
            },
        })

    const WHITE = { a: 1, b: 255, g: 255, r: 255 }

    // The text of a transparent token sits on the editor, so the choice of black
    // or white has to know what is behind it. `.cm-content` is usually
    // transparent and the colour lives on an ancestor, so walk up until one of
    // them answers with something that is not fully transparent. parseColor
    // reads the answer because getComputedStyle replies in the old comma syntax,
    // which it already parses. Two answers keep the walk going: one parseColor
    // does not recognise, such as the keyword `transparent`, and one that parses
    // but is fully see-through.
    //
    // That first non-transparent ancestor is then treated as opaque: `over`
    // composites onto its b, g and r and never discounts its alpha. The
    // approximation is exact when ancestor backgrounds are opaque or fully
    // transparent, which is what a MarkEdit editor presents. For a partly
    // transparent one it is wrong by however much shows through, and the true
    // colour would mean compositing that ancestor over its own ancestor in turn.
    const editorBackground = view => {
        for (let element = view.contentDOM; element; element = element.parentElement) {
            const color = parseColor(window.getComputedStyle(element).backgroundColor ?? '')
            if (color !== undefined && color.a > 0) return color
        }
        return WHITE
    }

    // Only the visible ranges are walked, so the work is bounded by the screen
    // and not by the size of the document. The background is read one time for
    // each build that paints, not one time for each colour.
    const buildDecorations = view => {
        const builder = new RangeSetBuilder()
        // Off is an empty set rather than an absent plugin: this script adds its
        // extension one time, at load, and never takes it back, so the switch
        // has to sit where the work is.
        if (!enabled) return builder.finish()

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

    // A ViewPlugin repaints only when an update gives it a reason to, and a flip
    // of the switch changes neither the document nor the viewport. The effect is
    // that reason and nothing else: it carries no value, and `of` takes one, so
    // it is handed an undefined.
    const repaint = StateEffect.define()

    const rebuilds = update =>
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some(transaction => transaction.effects.some(effect => effect.is(repaint)))

    MarkEdit.addExtension(
        ViewPlugin.fromClass(
            class {
                constructor(view) {
                    this.decorations = buildDecorations(view)
                }

                update(update) {
                    if (rebuilds(update)) this.decorations = buildDecorations(update.view)
                }
            },
            { decorations: instance => instance.decorations },
        ),
    )

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
                // undefined means the read failed, which is not proof that the file
                // is absent. A write now could replace a real settings.json with this
                // one key, so refuse until a listing proves that the file is not there.
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

    // The checkmark and the guard in buildDecorations read the same boolean. A
    // StateField holding it was considered and rejected: it would be a second
    // place where "is this on?" lives, and the menu item would still need the
    // module value to draw its checkmark. The optional call is defensive: with
    // no view there is nothing to dispatch to, and the flip stands on its own.
    // The write is started and not awaited: the repaint is what the user is
    // waiting on, and persistEnabled reports its own failures through an alert.
    const toggle = () => {
        enabled = !enabled
        MarkEdit.editorView?.dispatch({ effects: repaint.of(undefined) })
        void persistEnabled()
    }

    MarkEdit.addMainMenuItem({
        action: toggle,
        state: () => ({ isSelected: enabled }),
        title: MENU_TITLE,
    })
})()
