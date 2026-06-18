# MarkEdit Theme Toggle

A [MarkEdit](https://github.com/MarkEdit-app/MarkEdit) user-script plugin that adds
a toolbar button to swap the editor between your light and dark themes, live — no
restart.

## Scope

This button swaps the **editor theme** (the CodeMirror editing surface), live. That
is the only theme lever MarkEdit exposes to a user script — it calls the same
internal bridge MarkEdit uses to apply themes.

What it does **not** do, and why:

- **Preview mode is not affected.** The Markdown preview pane themes itself off the
  native window appearance (`prefers-color-scheme`), which a sandboxed user script
  cannot change. So this button changes the editor in edit mode but leaves preview
  as-is.
- **Native window/toolbar chrome** is not directly controlled (the toolbar tint
  happens to follow because MarkEdit recolors it from the editor background).

### Want a full light/dark swap (editor **and** preview)?

Use MarkEdit's built-in control: **Settings → General → Appearance → Light / Dark**.
That flips the app appearance, which drives both the editor (via your configured
light/dark themes) and the preview together, live. There is no plugin/toolbar hook
for app appearance — it lives only in Settings — so this script and that setting are
complementary: the button for a quick editor swap, the setting for an everything
swap.

## Install

```bash
./install.sh
```

This copies `scripts/theme-toggle.js` into MarkEdit's sandbox at
`~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/`.

Then add the toolbar button: merge `settings.snippet.json` into
`~/Library/Containers/app.cyan.markedit/Data/Documents/settings.json` — specifically
the `editor.customToolbarItems` array — and restart MarkEdit.

## Configure the themes

By default the toggle swaps `github-light` ↔ `github-dark`. Set your own pair in
`settings.json`:

```json
{
  "extension.themeToggle": { "light": "minimal-light", "dark": "minimal-dark" }
}
```

Built-in theme names include `github-*`, `xcode-*`, `solarized-*`, `minimal-*`,
and `winter-is-coming-*` (each with a `-light` and `-dark` variant).

## Use

After restarting, add the button to the toolbar: **View → Customize Toolbar…**, then
drag the half-filled-circle **Toggle Theme** item into the toolbar. (A
`customToolbarItems` entry only makes the item *available*; you place it via
Customize Toolbar.)

Then click the toolbar button, or use **Extensions → Toggle Light/Dark Theme** from
the menu bar. The menu item shows a checkmark when the dark theme is active.

## Uninstall

Delete `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/theme-toggle.js`,
remove the toolbar entry from `settings.json`, and restart MarkEdit.

## Develop

Run the tests (Node 18+, no dependencies):

```bash
node --test
```

The plugin stays a plain drop-in script; tests load it in a `node:vm` sandbox with
stubbed `MarkEdit`/`window` globals.
