# copy-on-select

A MarkEdit user script that copies the selected text to the clipboard when a mouse selection ends. This is the behavior of the
"Copy to pasteboard on selection" option of iTerm2. No keystroke is necessary.

## Install

From the root of the repository:

```bash
./install.sh copy-on-select
```

This copies `copy-on-select.js` into the MarkEdit sandbox at `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/`.
Restart MarkEdit.

## Use

Select text with the mouse. The text goes to the clipboard when you release the button. Three gestures copy:

- A click and drag across a range.
- A double-click, which selects a word.
- A triple-click, which selects a line.

To turn the extension on and off, use **Extensions → Copy on Select** in the menu bar. The item shows a checkmark when the
extension is on. The state is written to `settings.json`, so it survives a restart.

The extension is on after you install it.

## What does not copy

Keyboard selections never copy. In an editor you make keyboard selections constantly, with Shift-Arrow and its variants. If
those selections wrote to the clipboard, an edit would destroy the text that you copied with Command-C.

The extension also skips a selection when its text is the same as the text that it wrote last. This stops a flood of identical
entries in a clipboard manager.

## Configure

The extension writes this key when you use the menu item. To set the start state yourself, put it in `settings.json`:

```json
{
  "extension.copyOnSelect": { "enabled": true }
}
```

## Limits

macOS gives a user script only the general pasteboard. There is no equivalent of the X11 primary selection. Every mouse
selection therefore replaces the text that you last copied with Command-C. This is also the behavior of iTerm2. If that gets in
the way, turn the extension off from the menu.

The extension covers the editor only. A user script cannot reach the Markdown preview pane.

## Uninstall

1. Delete `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/copy-on-select.js`.
2. Remove the `extension.copyOnSelect` key from `settings.json`.
3. Restart MarkEdit.

## Develop

Run the tests from the root of the repository:

```bash
npm test
```

The tests load the drop-in script in a `node:vm` sandbox. The sandbox stubs `markedit-api`, `@codemirror/view`, `document`, and
`navigator.clipboard`, then calls the handlers that the script registers.
