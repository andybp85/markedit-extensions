# MarkEdit Extensions

User scripts for [MarkEdit](https://github.com/MarkEdit-app/MarkEdit), the native
macOS Markdown editor. Each extension is a drop-in JavaScript file that MarkEdit
loads from its script sandbox. There is no build step and there are no runtime
dependencies.

## Extensions

| Extension | What it does |
| --- | --- |
| [toggle-dark](extensions/toggle-dark/) | Adds a toolbar button that swaps the editor between your light and dark themes, live. |
| [copy-on-select](extensions/copy-on-select/) | Copies the selected text to the clipboard when a mouse selection ends, like iTerm2. |

## Install

Install every extension:

```bash
./install.sh
```

Install one extension:

```bash
./install.sh toggle-dark
```

The installer copies each extension script into the MarkEdit sandbox at
`~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/`. To install
somewhere else, set `MARKEDIT_DOCS` to the MarkEdit `Documents` directory.

Some extensions also need an entry in `settings.json`. The installer prints the
path of the `settings.snippet.json` file for each one. Merge that file into
`~/Library/Containers/app.cyan.markedit/Data/Documents/settings.json`. Then
restart MarkEdit. Read the README of the extension for the details.

## Test

```bash
npm test
```

This runs `node --test` over the whole repository. Node 20 or later is
necessary. There are no dependencies.

The tests load each drop-in script in a `node:vm` sandbox with stub `MarkEdit`
and `window` globals. The installer tests run `install.sh` against a temporary
directory, so they never write to the real MarkEdit sandbox.

## Repository layout

```
install.sh                    installs extensions into the MarkEdit sandbox
test/                         tests for the installer
docs/                         design specs and implementation plans
extensions/<name>/
    <name>.js                 the drop-in script
    settings.snippet.json     optional fragment for settings.json
    README.md                 what the extension does and how to configure it
    test/                     tests for the extension
```

## Add an extension

1. Make a directory for the extension under `extensions/`.
2. Put the drop-in script at the top level of that directory. The installer
   copies every top-level `.js` file and ignores the subdirectories.
3. If the extension needs an entry in `settings.json`, add
   `settings.snippet.json` next to the script.
4. Write a `README.md` for the extension and put its tests in `test/`.
5. Add a row to the table of extensions above.
6. Run `npm test`.

## Scope and limits

MarkEdit gives a user script the editor surface and the menu bar. It does not
give the script the native window appearance. An extension can therefore change
the CodeMirror editing surface, but not the Markdown preview pane, which themes
itself from the system appearance.
