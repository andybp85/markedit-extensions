# toggle-dark

A MarkEdit user script that adds a toolbar button. The button swaps the editor between your light and dark themes, live. No
restart is necessary.

## Install

From the root of the repository:

```bash
./install.sh toggle-dark
```

This copies `theme-toggle.js` into the MarkEdit sandbox at `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/`.

Then merge `settings.snippet.json` into `~/Library/Containers/app.cyan.markedit/Data/Documents/settings.json`. The snippet adds
one entry to the `editor.customToolbarItems` array. Restart MarkEdit.

## Use

A `customToolbarItems` entry only makes the item available. To place it, open **View → Customize Toolbar…**, then drag the
half-filled-circle **Toggle Theme** item into the toolbar.

Then click the toolbar button, or use **Extensions → Toggle Light/Dark Theme** in the menu bar. The menu item shows a checkmark
when the dark theme is active.

## Configure the themes

The toggle swaps `github-light` and `github-dark` by default. To set your own pair, add this to `settings.json`:

```json
{
  "extension.themeToggle": { "light": "minimal-light", "dark": "minimal-dark" }
}
```

The built-in theme names include `github-*`, `xcode-*`, `solarized-*`, `minimal-*`, and `winter-is-coming-*`. Each one has a
`-light` and a `-dark` variant.

## Scope

The button swaps the **editor theme**, which is the CodeMirror editing surface. This is the only theme lever that MarkEdit gives
to a user script. The script calls the same internal bridge that MarkEdit uses to apply themes.

Two things the button does not do:

- **The preview pane does not change.** The Markdown preview themes itself from the native window appearance
  (`prefers-color-scheme`), which a sandboxed user script cannot set. The button therefore changes the editor in edit mode and
  leaves the preview as it is.
- **The native window and toolbar chrome are not controlled directly.** The toolbar tint follows anyway, because MarkEdit
  recolors it from the editor background.

### For a full light and dark swap

Use the built-in control of MarkEdit: **Settings → General → Appearance → Light / Dark**. This flips the app appearance, which
drives the editor and the preview together, live.

There is no plugin or toolbar hook for the app appearance. It exists only in Settings. The script and the setting are therefore
complementary: the button for a quick editor swap, the setting for an everything swap.

## Uninstall

1. Delete `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/theme-toggle.js`.
2. Remove the toolbar entry from `settings.json`.
3. Restart MarkEdit.

## Develop

Run the tests from the root of the repository:

```bash
npm test
```

The extension stays a plain drop-in script. The tests load it in a `node:vm` sandbox with stub `MarkEdit` and `window` globals.
