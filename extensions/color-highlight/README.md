# Color Highlight

A MarkEdit user script that paints every colour literal in the editor with the colour it names, and sets the text of the
token to black or white, whichever reads better on it.

## Install

From the root of the repository:

```bash
./install.sh color-highlight
```

This copies `color-highlight.js` into the MarkEdit sandbox at `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/`.
Restart MarkEdit.

## What paints

| Kind | Examples |
| --- | --- |
| Hex, 3 or 6 digits | `#f00`, `#ff0000` |
| Hex with alpha, 4 or 8 digits | `#f00c`, `#ff0000cc` |
| `rgb()` and `rgba()` | `rgb(255, 0, 0)`, `rgb(255 0 0 / 50%)` |
| `hsl()` and `hsla()` | `hsl(0, 100%, 50%)`, `hsl(0deg 100% 50% / 50%)` |

Both the comma syntax and the space syntax are read, in the channels and in the alpha. A token with alpha paints at that
alpha, so the editor shows through it.

Every part of the document is painted: a colour in a sentence, in a code span, and in a fenced block all look alike.

## Configure

To turn the extension on and off, use **Extensions → Highlight Colors** in the menu bar. The item shows a checkmark when
the extension is on. The choice is written to `settings.json` under the `extension.colorHighlight` key, so it survives a
restart. To set the start state yourself, put it in `settings.json`:

```json
{
  "extension.colorHighlight": { "enabled": true }
}
```

The extension is on after you install it.

## What does not paint

A hex token that opens a line paints nothing, ignoring indentation. A line that starts with `#` is a Markdown heading, and
a run of hex digits in that position is far more often a heading or an anchor than a colour. A real colour follows a
property name, a word, or a list marker. The cost is a list of bare colours, one to a line, which paints nothing.

A hex token joined to a word, such as `page#abc`, paints nothing, and neither does a run of hex digits at a length CSS
does not define, such as `#12345`.

The rule about the start of a line is for hex only. `rgb(255, 0, 0)` is not heading-shaped and paints anywhere.

A percentage hue, such as `hsl(50% 100% 50%)`, paints nothing. CSS never writes a hue as a percentage, so the parser
refuses one rather than guess at a meaning.

Named colours such as `tomato`, and the modern spaces `lab()` and `oklch()`, are not painted.

## Limits

The colour of the editor background is read when the paint is built. It matters only for a token that has alpha, since
the editor shows through such a token. After a theme change, the text colour of a transparent token keeps its old choice
until the next edit or the next scroll. An opaque token is not affected: its text sits on its own colour.

The extension covers the editor only. A user script cannot reach the Markdown preview pane.

## Uninstall

1. Delete `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/color-highlight.js`.
1. Remove the `extension.colorHighlight` key from `settings.json`.
1. Restart MarkEdit.

## Develop

Run the tests from the root of the repository:

```bash
npm test
```

The tests load the drop-in script in a `node:vm` sandbox with stub `MarkEdit`, `@codemirror/view`, `@codemirror/state`,
and `window` globals.
