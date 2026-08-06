# Design: copy-on-select

Date: 2026-08-06
Status: approved
Extension: `extensions/copy-on-select`

## Purpose

Copy the selected text to the clipboard when a mouse selection ends, like the
"Copy to pasteboard on selection" option of iTerm2. The user selects text with
the mouse and pastes it somewhere else. No keystroke is necessary.

## Behavior

The extension copies when a mouse selection ends. A mouse selection ends on
`mouseup`. This covers three gestures:

- A click and drag across a range.
- A double-click, which selects a word.
- A triple-click, which selects a line.

CodeMirror applies the word selection and the line selection on `mousedown`. The
selection is therefore final when `mouseup` occurs, and one handler covers all
three gestures.

Keyboard selections never copy. In an editor you make keyboard selections
constantly, with Shift-Arrow and its variants. If those selections wrote to the
clipboard, an edit would destroy the text that you copied with Command-C.

### Skip rules

The extension copies any non-empty selection, with one exception. If the text is
the same as the text that the extension wrote last, the extension does not write
again. This stops a flood of identical entries in a clipboard manager when you
select the same word more than one time.

Whitespace-only selections and one-character selections copy. Only repeats are
skipped.

The record shows what the extension wrote. It does not show what is on the
clipboard, because another application or Command-C can replace the clipboard.
The extension clears the record on a `blur` of the window and on a `copy` event.
A selection of the same text then copies again, which keeps the clipboard and the
record in agreement.

### On and off

An item in the Extensions menu turns the extension on and off. The item shows a
checkmark when the extension is on. The state is written to `settings.json`, so
it survives a restart.

The extension is on by default when the settings key is absent.

## Constraints

macOS gives a user script only the general pasteboard. There is no equivalent of
the X11 primary selection. Every mouse selection therefore replaces the text that
you last copied with Command-C. This is also the behavior of iTerm2.

The extension cannot reach the Markdown preview pane. MarkEdit gives a user
script the CodeMirror editing surface and the menu bar only.

## Architecture

One drop-in script, `extensions/copy-on-select/copy-on-select.js`.

```
extensions/copy-on-select/
├── copy-on-select.js
├── README.md
└── test/copy-on-select.test.mjs
```

There is no `settings.snippet.json`. The extension adds no toolbar item, and the
toggle writes its own settings key. `install.sh` prints the merge instruction
only for the extensions that have the file, so the installer needs no change.

### Units

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `selectedText(state)` | Join all non-empty selection ranges with a newline. Pure function. | The CodeMirror state |
| `copySelection(view)` | Apply the skip rules, write the clipboard, record the text | `selectedText`, `navigator.clipboard` |
| `persistEnabled(enabled)` | Read `settings.json`, merge one key, write it back | The MarkEdit file APIs |
| Menu registration | Add the checkmark item, flip the state, start the write | `MarkEdit.addMainMenuItem` |
| Listener registration | Attach the mouse handlers and the clipboard handlers | `EditorView`, `copySelection` |

Module state is three values: `enabled` (boolean), `lastCopied` (string) and
`mouseSelecting` (boolean). Everything else is a pure function of its arguments.

### Data flow

```
mouseup ──> copySelection(view)
              ├─ enabled === false? ......... return
              ├─ text = selectedText(state)
              ├─ text === ''? ............... return
              ├─ text === lastCopied? ....... return
              ├─ lastCopied = text
              └─ clipboard.writeText(text) ─> on failure, clear the record if it
                                              still holds this text
```

The extension records the text before the write, not after. The write is
asynchronous. If the extension recorded the text after the write, the two
`mouseup` handlers below could both run before either write finished, and both
would see the old value and write. The skip rule protects the overlap only when
the record happens first.

A failed write clears the record, so the next selection of the same text can try
again. It clears the record only when the record still holds its own text. A
later selection can own the record before the failure arrives, and that write did
not fail.

`selectedText` joins every non-empty range with a newline. It does not read the
main range alone. Command-C on a multi-cursor selection produces the same text,
so the menu item and the key agree.

### Listeners

The MarkEdit script runtime supplies the CodeMirror modules to `require`, which
the MarkEdit-vim extension confirms. The primary handler is a CodeMirror DOM
event handler:

```js
const { EditorView } = require('@codemirror/view')
MarkEdit.addExtension(EditorView.domEventHandlers({
  mousedown: event => { mouseSelecting = event.button === 0 },
  mouseup: (event, view) => {
    mouseSelecting = false
    if (event.button === 0) copySelection(view)
  }
}))
```

The handler receives the view, so the code reads the selection from its
argument. It does not read a global.

A drag that ends outside the editor never fires `mouseup` on the editor element.
A second handler on `document` is therefore necessary as a backstop. The script
attaches this handler one time, at load.

The backstop receives no view, because it is not a CodeMirror handler. It reads
`MarkEdit.editorView` instead, and it returns when that value is absent. This is
the only place in the extension that reads a global view.

CodeMirror attaches `domEventHandlers` to the editor content, not to the whole
editor. A `mouseup` on the line-number gutter, on the scroller, or on a panel
therefore reaches the backstop only. The selection at that moment can be a
keyboard selection, and a copy of it would break the rule that keyboard
selections never copy.

`mouseSelecting` prevents this. A `mousedown` on the editor content makes it
true, and a `mouseup` makes it false again. The backstop copies only while it is
true. Both handlers also ignore a button other than the primary button, so a
right-click or a middle-click on a keyboard selection copies nothing.

The two handlers can both fire for one gesture. This is harmless: the editor
handler clears `mouseSelecting`, and the backstop returns. If the order is
different, the second call sees the same text in `lastCopied` and returns. The
skip rule makes the overlap safe.

### Persistence

The settings key is `extension.copyOnSelect`. Its shape is `{ "enabled": true }`.

The extension reads the key from `MarkEdit.userSettings` at load. MarkEdit reads
`settings.json` at launch, so a write takes effect at the next launch, which is
the correct behavior for a stored preference.

A toggle writes the file with the pattern of the `markedit-direct-preview`
extension:

1. Read `settings.json` with `MarkEdit.getFileContent`.
2. Parse it.
3. Merge the `extension.copyOnSelect` key. Leave every other key as it is.
4. Write it with `MarkEdit.createFile({ overwrites: true })`.

**CAUTION: If `settings.json` exists but does not parse, do not write the file.**
A read-modify-write that treats an unparseable file as an empty object replaces
all MarkEdit settings of the user with one key. On a parse failure the extension
shows an alert and leaves the file alone. The toggle still works for the current
session.

An empty file is not a parse failure. In that case the extension writes a new
file with the one key.

A non-string return is also not proof that the file is absent. The MarkEdit API
declares `getFileContent(path?: string): Promise<string | undefined>`, and it
documents `undefined` as "failed", not as "not there". A write after a failed
read causes the same loss as a write after a parse failure.

The extension therefore proves absence before it writes a new file:

1. Call `MarkEdit.listFiles(MarkEdit.getDirectoryPath('documents'))`.
2. If the listing fails, or if it holds `settings.json`, show an alert and
   return. Do not write.
3. Only a successful listing that does not hold `settings.json` permits a new
   file.

The read failure and the write failure show different messages, because the two
give the user different work to do.

## Error handling

| Error | Response |
| --- | --- |
| `clipboard.writeText` rejects | `console.warn`, then continue. This can occur on every selection, so an alert is not usable. |
| `settings.json` does not parse | Alert one time for each session. Do not write the file. |
| The read of `settings.json` fails, and no listing proves absence | Alert one time for each session. Do not write the file. |
| The write of `settings.json` fails | Alert one time for each session. Keep the state in memory. |

## Testing

The tests use the `node:vm` harness of the `toggle-dark` extension, with more
stubs:

- `require('@codemirror/view')` returns an `EditorView` stub whose
  `domEventHandlers` returns its argument. A test can then call a handler
  directly.
- `document` records the listeners that the script attaches.
- `navigator.clipboard.writeText` is a spy that resolves.
- The fake view supplies `state.selection.ranges` and `state.sliceDoc`.

Twelve cases:

1. The script registers a menu item with the title "Copy on Select".
2. A `mouseup` with a non-empty selection writes the selected text.
3. A `mouseup` with an empty selection writes nothing.
4. Two identical selections write one time.
5. A different selection after a repeat writes again.
6. A `mouseup` writes nothing when the extension is off.
7. The menu state shows the value of `enabled`.
8. A multi-range selection joins the ranges with a newline.
9. The handler on `document` copies through `MarkEdit.editorView`, and it
   deduplicates against the handler of the editor. It returns without an error
   when `MarkEdit.editorView` is absent.
10. A toggle writes `settings.json` with the merged key and the unrelated keys
    intact.
11. A malformed `settings.json` produces an alert and no write.
12. A rejected clipboard promise does not throw.

## Repository updates

- Add a row for the extension to the table in the root `README.md`.
- Add a `1.1.0` entry to `CHANGELOG.md`. A new extension is a backward compatible
  addition, so the minor version increases.
- Set the version in `package.json` to `1.1.0`.

## Out of scope

- **Middle-click paste.** This is the other half of the iTerm2 behavior. It is a
  separate feature with its own design.
- **A toolbar button.** The menu item is sufficient. A button is easy to add
  later with a `settings.snippet.json` file.
- **The preview pane.** A user script cannot reach it.
