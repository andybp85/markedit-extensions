# MarkEdit Theme Toggle

A [MarkEdit](https://github.com/MarkEdit-app/MarkEdit) user-script plugin that adds
a toolbar button to swap the editor between your light and dark themes, live — no
restart.

## Scope

A MarkEdit user script runs inside the editor WebView, so this themes the **editor
surface** (the CodeMirror view) only — not the native macOS window or toolbar
chrome. It is a manual, live override; MarkEdit may re-apply its own
appearance-driven theme when you change the system light/dark setting or relaunch.

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

Click the toolbar button (a half-filled circle), or use **Extensions → Toggle
Light/Dark Theme** from the menu bar. The menu item shows a checkmark when the dark
theme is active.

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
