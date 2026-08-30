# Design: color-highlight

Date: 2026-08-30
Status: approved
Extension: `extensions/color-highlight`

## Purpose

Paint every CSS color token in the editor with the color it names. The text of
the token turns black or white, whichever reads better on that color. A person
writing a stylesheet, a theme file, or a set of design notes then sees the
colors instead of reading the codes.

## Behavior

The extension paints four kinds of token:

| Kind | Examples |
| --- | --- |
| Hex, 3 or 6 digits | `#f00`, `#ff0000` |
| Hex with alpha, 4 or 8 digits | `#f00c`, `#ff0000cc` |
| `rgb()` and `rgba()` | `rgb(255, 0, 0)`, `rgb(255 0 0 / 50%)`, `rgba(100%, 0%, 0%, .5)` |
| `hsl()` and `hsla()` | `hsl(0, 100%, 50%)`, `hsl(0deg 100% 50% / 50%)` |

Both the old comma syntax and the current space syntax are accepted, in the
functional forms and in the alpha. Case does not matter.

The paint covers the whole token, including the `#` and including the closing
parenthesis. The background is the color. The text is black or white. The
corners are rounded a little. There is no padding, so the characters of the
editor stay in their columns.

A token with alpha paints with that alpha, so the editor shows through it. This
is honest: `#ff000080` is not the same color as `#ff0000`, and it should not
look the same.

Every part of the document is painted. A color in a sentence, a color in a code
span, and a color in a fenced block all look alike. The inline style of the
decoration wins over the class that gives a token its syntax color, so a color
inside a CSS block paints correctly.

The cursor does not change the paint. A token stays painted while you edit it.
A token stops being painted the moment it stops being a color, and starts again
when it becomes one.

### What is not a color

The extension finds candidates by shape and then decides. A candidate that does
not parse is left alone. This matters most for hex:

- `#abcdefgh` paints nothing. The run of hex digits is 6 long and is followed by
  more letters, so the token is not a color, and `#abcdef` is not extracted from
  inside it.
- `#12345` paints nothing. Five digits is not a length that CSS defines.
- `#ff0000` in `word#ff0000` paints nothing. A word character before the `#`
  means the token belongs to something else.

The same rule holds for the functional forms. `rgb(1, 2)` and `hsl(a, b, c)`
paint nothing.

A hex token is also dropped when it is the first thing on its line, ignoring
the indentation. In Markdown a line that opens with `#` is a heading, and a run
of hex digits in that position is far more often a heading or an anchor than a
color. A real color literal almost never starts a line: it follows a property
name, an equals sign, a word, or a list marker.

```text
#face                     paints nothing, it opens the line
    #face                 paints nothing, indentation does not count
- #face                   paints, the list marker comes first
The brand is #face        paints
color: #face;             paints
```

The rule is for hex only. `rgb(255, 0, 0)` at the start of a line is not
heading-shaped and is not ambiguous, so it paints.

The cost is a list of bare colors, one to a line, which paints nothing. That is
the price of never painting a heading, and it was chosen deliberately.

### On and off

An item in the Extensions menu turns the extension on and off. The item shows a
checkmark when the extension is on. The state is written to `settings.json`, so
it survives a restart. The extension is on by default when the settings key is
absent.

Turning the extension off removes the paint at once. Turning it on puts the
paint back at once.

## Constraints

The extension cannot reach the Markdown preview pane. MarkEdit gives a user
script the CodeMirror editing surface and the menu bar only.

The color of the editor background is read when the decorations are built. It is
needed only to choose the text color of a token that has alpha, because the
editor shows through such a token. After a theme change, the paint of a
transparent token keeps the old choice until the next edit or the next scroll.
An opaque token is not affected: its text sits on its own color, not on the
editor.

## Architecture

One drop-in script, `extensions/color-highlight/color-highlight.js`.

```text
extensions/color-highlight/
├── color-highlight.js
├── README.md
└── test/color-highlight.test.mjs
```

There is no `settings.snippet.json`. The extension adds no toolbar item, and the
toggle writes its own settings key, in the manner of `copy-on-select`.

The file has two halves. The first half is colors: it parses text and does
arithmetic, and it knows nothing of CodeMirror or of the DOM. The second half is
the editor: it walks the visible text, calls the first half, and builds
decorations. Almost all of the work is in the first half, where it can be tested
directly.

### Units

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `findCandidates(text)` | Find the shapes that could be colors. Return their offsets and their source text. Pure function. | Nothing |
| `parseColor(source)` | Turn one source string into `{ r, g, b, a }`, or into `undefined`. Pure function. | `parseArgs`, `hslToRgb` |
| `parseArgs(inner)` | Split the inside of a functional form into three channels and an alpha. Pure function. | Nothing |
| `hslToRgb(h, s, l)` | Convert one hue, saturation and lightness to red, green and blue. Pure function. | Nothing |
| `luminance(color)` | The WCAG relative luminance of an opaque color. Pure function. | Nothing |
| `contrastColor(color, background)` | Choose black or white for the text. Pure function. | `luminance` |
| `findColors(line)` | Every parsed color in one line, with its offsets into that line. Pure function. | `findCandidates`, `parseColor` |
| `editorBackground(view)` | The background color behind the text, or white | `getComputedStyle`, `parseColor` |
| `buildDecorations(view)` | Walk the lines of the visible ranges and build the decoration set | `findColors`, `contrastColor`, `editorBackground` |
| `persistEnabled()` | Read `settings.json`, merge one key, write it back | The MarkEdit file APIs |
| Menu registration | Add the checkmark item, flip the state, force a rebuild | `MarkEdit.addMainMenuItem` |

Module state is one value: `enabled`. Everything else is a pure function of its
arguments or is derived from the view.

### Finding the candidates

One regular expression finds the shapes:

```js
/#[0-9a-f]+|\b(?:rgb|hsl)a?\([^()\n]*\)/gi
```

It is deliberately loose. It finds a run of hex digits of any length, and it
finds anything between the parentheses that is not a parenthesis and not a
newline. `parseColor` is what decides.

A sweep runs over one line of the document. This is what makes the two rules
that reject a hex candidate well defined:

- **A word character before the `#`.** The check reads the character at
  `index - 1` of the line. It does not use a lookbehind in the pattern, because
  the WebView that runs the script is not guaranteed to have one.
- **First on the line.** The candidate starts the line when everything at a
  lower index is whitespace.

Neither rule can be stated against a slice of arbitrary text, because a slice
does not know where its line began. Sweeping a line at a time removes the
question instead of answering it.

The regular expression is greedy on the hex digits, so `#abcdefgh` yields the
candidate `#abcdefgh`, which has 8 letters, two of which are not hex digits, and
which therefore does not parse. This is the reason to find the whole run rather
than the first six digits.

### Parsing a color

`parseColor` returns `{ r, g, b, a }` with `r`, `g` and `b` in `0..255` and `a`
in `0..1`, or `undefined`. Every value it returns is a real color, so nothing
after it needs to check.

Hex is accepted at 3, 4, 6 and 8 digits and at no other length. The short forms
double each digit: `#f8c` is `#ff88cc`, and `#f8c4` is `#ff88cc44`.

For a functional form, `parseArgs` splits the inside:

1. If the text holds a `/`, the part after it is the alpha, and the part before
   it is the channels.
1. If the channels hold a comma, split on commas. Otherwise split on runs of
   whitespace.
1. If that gives four parts and no alpha was found in the first step, the fourth
   part is the alpha.
1. Three channels must remain. Any other count is a failure.

A single value must match `^[+-]?(?:\d+\.?\d*|\.\d+)%?$`, with an optional `deg`
allowed on a hue. `none`, `rad`, `turn` and `calc()` are failures. They are rare
in hand-written color literals, and a failure means the token is left alone,
which is the safe outcome.

The channels are then read for the form:

- `rgb`: a percentage is of 255, a plain number is already `0..255`. Clamp.
- `hsl`: the hue is degrees, normalized into `0..360`; the saturation and the
  lightness are `0..100`, whether or not the `%` is written. Clamp, then convert
  with `hslToRgb`.
- The alpha is a percentage of 1, or a plain number in `0..1`. Clamp. An absent
  alpha is `1`.

A permissive reading is chosen on purpose. `rgb(255, 0, 0 / 50%)` mixes two
syntaxes and is not valid CSS, and this parser accepts it. Rejecting it would
add rules that only ever refuse to paint something the author clearly meant as a
color.

### Choosing the text color

The text color is black or white, by WCAG relative luminance. For each channel,
normalize to `0..1`, then linearize:

```text
c_linear = c / 12.92                     when c <= 0.03928
c_linear = ((c + 0.055) / 1.055) ** 2.4  otherwise
L = 0.2126 * r + 0.7152 * g + 0.0722 * b
```

Black text when `L > 0.179`, white text otherwise. That threshold is not a
guess. The contrast ratio against white is `1.05 / (L + 0.05)` and against black
is `(L + 0.05) / 0.05`. The two are equal when `(L + 0.05)² = 0.0525`, which is
`L = 0.17912878...`. Above it, black wins; below it, white wins. The constant in
the code is `0.179`, and the two tests of the threshold sit far enough to either
side that the rounding does not decide them.

This is the real formula, not the YIQ approximation. It is the same amount of
code and it is correct.

A color with alpha is composited over the background before its luminance is
measured, because that is what the eye sees:

```text
c_seen = c_color * a + c_background * (1 - a)
```

The background is a parameter of `contrastColor`, not something it reads. This
keeps the function pure and lets a test set the background it wants.

### Building the decorations

A `ViewPlugin` holds a `DecorationSet`:

```js
const { Decoration, EditorView, ViewPlugin } = require('@codemirror/view')
const { RangeSetBuilder, StateEffect } = require('@codemirror/state')
```

The plugin builds the set when it is constructed, and again when the document
changes, when the viewport changes, or when the toggle fires. It walks
`view.visibleRanges`, so the work is bounded by what is on the screen and not by
the size of the document.

Inside a visible range it walks one line at a time, with `doc.lineAt`, and
calls `findColors` on the text of each line. The offsets that come back are
relative to the line, so the plugin adds `line.from` to each before it adds the
decoration:

```js
for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
        const line = view.state.doc.lineAt(pos)
        for (const found of findColors(line.text)) {
            builder.add(line.from + found.from, line.from + found.to, mark(found.color, background))
        }
        pos = line.to + 1
    }
}
```

Lines come out in order, and the matches within a line come out in order and do
not overlap, which is what `RangeSetBuilder` requires.

The mark carries an inline style:

```css
background-color: rgba(255, 0, 0, 1); color: #000000; border-radius: 3px;
```

The value is written by the extension from the parsed color, not copied from the
source. The source may use a syntax that the WebView does not accept, and the
normalized form always does.

`editorBackground` walks up from `view.contentDOM` until it finds an element
whose computed background is not transparent, and parses that value with
`parseColor`, since `getComputedStyle` returns the old comma syntax. It returns
white when it finds nothing. It is called one time for each build, not one time
for each color.

### The toggle

`enabled` is a module value. The menu item reads it and writes it.

A flip must repaint at once, and a `ViewPlugin` repaints only when it sees an
update. The toggle therefore dispatches a `StateEffect` on
`MarkEdit.editorView`, and the plugin rebuilds when it sees that effect. The
effect carries no data. It exists to make the update happen.

A `StateField` holding the same boolean was considered and rejected. It would be
a second place where the answer to "is this on?" lives, and the menu would still
need the module value to draw its checkmark.

### Persistence

The settings key is `extension.colorHighlight`. Its shape is `{ "enabled": true }`.

The extension reads the key from `MarkEdit.userSettings` at load, and writes the
file on each toggle, with the read-merge-write of `copy-on-select`:

1. Read `settings.json` with `MarkEdit.getFileContent`.
1. Parse it.
1. Merge the `extension.colorHighlight` key. Leave every other key as it is.
1. Write it with `MarkEdit.createFile({ overwrites: true })`.

**CAUTION: If `settings.json` exists but does not parse, do not write the file.**
Treating an unreadable file as an empty object replaces every MarkEdit setting
of the user with this one key.

A non-string return from `getFileContent` means the read failed, not that the
file is absent. Before writing a new file, the extension proves absence with
`MarkEdit.listFiles(MarkEdit.getDirectoryPath('documents'))`. A listing that
fails, or that holds `settings.json`, is not proof, and the extension does not
write.

This logic is the same as in `copy-on-select.js`. It is copied rather than
shared. Each extension is a single drop-in file that MarkEdit loads on its own,
so there is nowhere for shared code to live, and the installer copies files, not
module graphs. This is the second occurrence, and the rule of the house is to
extract on the third.

## Error handling

| Error | Response |
| --- | --- |
| A candidate does not parse | Paint nothing. This is normal and is not an error. |
| `getComputedStyle` gives no usable background | Use white. |
| `MarkEdit.editorView` is absent when the toggle fires | Flip the value and skip the dispatch. The next build reads the new value. |
| `settings.json` does not parse | Alert one time for each session. Do not write the file. |
| The read of `settings.json` fails, and no listing proves absence | Alert one time for each session. Do not write the file. |
| The write of `settings.json` fails | Alert one time for each session. Keep the state in memory. |

## Testing

The tests use the `node:vm` harness of the other two extensions, with stubs for
the CodeMirror modules:

- `Decoration.mark` returns its argument, so a test can read the style string.
- `RangeSetBuilder` collects `{ from, to, value }` into an array.
- `ViewPlugin.fromClass` returns both of its arguments, so a test can construct
  the plugin with a fake view and read its decorations through the spec.
- `StateEffect.define()` returns a type carrying `of`; `of(value)` returns an
  effect carrying `is`, so the plugin asks `effect.is(type)`.
- The fake view supplies `state.doc`, `visibleRanges` and a `contentDOM`, and
  the sandbox supplies a `getComputedStyle` that answers with a background.

A test asserts on the decorations that the plugin produces for a document. That
is the surface of this extension. The parsing functions are reached through it
rather than exported, so the tests stay honest about what the extension does.

Cases:

1. Each hex length, 3, 4, 6 and 8, paints with the expected background.
1. A hex run of another length paints nothing.
1. A hex token after a word character paints nothing.
1. A hex token that opens a line paints nothing, with and without indentation
   before it, and one after a list marker or a word on the same line paints.
1. `rgb()` that opens a line paints, because the rule is for hex only.
1. `rgb()` paints, in comma form and in space form.
1. `rgba()` paints, with the alpha in the fourth argument and after a slash.
1. Percentage channels paint the same color as the equivalent numbers.
1. `hsl()` converts correctly, at several hues and at zero saturation.
1. A hue written with `deg` paints, and one written with `turn` paints nothing.
1. A functional form with the wrong number of arguments paints nothing.
1. A channel out of range is clamped, not refused.
1. Black text is chosen for a light color and white text for a dark one.
1. The choice flips at the luminance threshold, tested from both sides.
1. A color with alpha composites over the background before the choice, and the
   same color chooses differently on a light and on a dark background.
1. Several colors on one line produce several decorations, in order.
1. A color on a line that is not visible is not scanned, and the offsets of a
   color on a later line are still correct.
1. The extension paints nothing while it is off.
1. The menu item has the title "Highlight Colors" and reports the state.
1. The toggle dispatches the effect, and does not throw when there is no view.
1. A toggle writes `settings.json` with the merged key and the unrelated keys
   intact.
1. A malformed `settings.json` produces an alert and no write.
1. An unreadable `settings.json` that a listing shows to be present produces an
   alert and no write.
1. A failed write produces an alert and leaves the toggle working in memory.

## Repository updates

- Add a row for the extension to the table in the root `README.md`.
- Write `extensions/color-highlight/README.md`, including the limit on the
  background of a transparent token after a theme change.
- Add a `1.2.0` entry to `CHANGELOG.md`. A new extension is a backward compatible
  addition, so the minor version increases.
- Set the version in `package.json` to `1.2.0`.

## Out of scope

- **Named CSS colors.** `tomato` and `rebeccapurple` would need a table of 148
  names in the file, and would paint the word "tan" in a sentence about
  leather.
- **`lab()`, `oklch()` and the other modern spaces.** They need conversions that
  are much larger than `hslToRgb`, and they are rare in hand-written notes.
- **A color picker.** Clicking a swatch to open one is a separate feature with
  its own design.
- **A swatch next to the token instead of paint on it.** The paint was chosen.
  A swatch is a widget decoration and would be a different extension.
- **The preview pane.** A user script cannot reach it.
