# MarkEdit Light/Dark Theme Toggle — Design

Date: 2026-06-18
Status: Approved

## Summary

A MarkEdit user-script plugin that adds a toolbar button (and a matching
Extensions-menu item) which swaps the editor between the user's configured
**light** and **dark** themes, live, with no restart.

## Scope

In scope:
- Toolbar button that toggles the editor theme.
- Extensions main-menu item (enables a keyboard shortcut and a checkmark state).
- Configurable light/dark theme names.
- Install tooling and documentation.

Explicitly out of scope:
- Theming the **native** macOS window/toolbar chrome. A JS user script runs in
  the editor WebView and can only affect the CodeMirror editor surface.
- Persisting the override across relaunches. The native app applies an
  appearance-driven theme on launch and on system light/dark changes; this
  button is a manual, live override of the editor theme, not a stored setting.
- A build step. The plugin ships as a single hand-written `.js` file.

## Mechanism (verified against MarkEdit source)

- **Swap live:** `window.webModules.config.setTheme({ name })`. This is the same
  internal bridge MarkEdit uses when the native appearance changes; it
  reconfigures the editor's theme compartment (`window.dynamics.theme.reconfigure`)
  and recolors via `setEditorColors`.
  - Source: `CoreEditor/src/bridge/web/config.ts` (`setTheme({ name })` → `setTheme(name)`),
    `CoreEditor/src/styling/config.ts` (`setTheme(theme)` dispatch).
- **Read current theme:** `MarkEdit.editorConfig.theme` (public MarkEdit-api,
  `editorConfig: Record`).
- **Built-in theme names** (`CoreEditor/src/styling/themes/index.ts`):
  `github-light`, `github-dark`, `xcode-light`, `xcode-dark`,
  `solarized-light`, `solarized-dark`, `minimal-light`, `minimal-dark`,
  `winter-is-coming-light`, `winter-is-coming-dark` (and additional pairs).
- **Toolbar item schema** (`schemas/settings.json` → `customToolbarItem`):
  requires `title` + `icon` (SF Symbol name); optional `actionName` and/or
  `menuName`. `menuName` dispatches a registered main-menu item by name.
- **Menu registration** (MarkEdit-api `addMainMenuItem(item)`): `MenuItem` has
  `title`, `action: () => void`, optional `state: () => MenuItemState`
  (`isSelected` drives a checkmark), and optional `key`/`modifiers` for a shortcut.

## Components

Single plain-JS user script: `scripts/theme-toggle.js`.

1. **Config read.** Light/dark theme names read from
   `MarkEdit.userSettings["extension.themeToggle"]`, shape
   `{ "light": string, "dark": string }`. Defaults: `light = "github-light"`,
   `dark = "github-dark"` when unset or partially set.

2. **State detection.** `isDark()` returns whether the current
   `MarkEdit.editorConfig.theme` equals the configured dark name. (If the
   current theme is neither configured name, treat as not-dark so the first
   press goes to dark.)

3. **Toggle action.** If currently dark → `setTheme({ name: light })`; else →
   `setTheme({ name: dark })`. Guarded: if `window.webModules?.config?.setTheme`
   is unavailable (api drift across MarkEdit versions), show a
   `MarkEdit.showAlert` explaining the toggle is unavailable and do nothing else.

4. **Menu registration.** On load, `MarkEdit.addMainMenuItem({ title: "Toggle
   Light/Dark Theme", action: toggle, state: () => ({ isSelected: isDark() }) })`.
   Item appears under the Extensions submenu.

5. **Toolbar wiring (settings.json, user-applied).**
   `editor.customToolbarItems` gains
   `{ "title": "Toggle Theme", "icon": "circle.lefthalf.filled",
   "menuName": "Toggle Light/Dark Theme" }`. The `menuName` must match the
   registered menu item; exact match form (bare title vs. path) is confirmed by
   testing during implementation and documented in the README.

## Error handling

- Missing `window.webModules.config.setTheme` → guarded no-op with an alert.
- `MarkEdit.editorConfig.theme` absent/unexpected → `isDark()` returns false.
- Invalid configured theme name → MarkEdit's `loadTheme` falls back to
  `github-light` internally; documented as a user responsibility.

## Repo deliverables

- `scripts/theme-toggle.js` — the plugin.
- `settings.snippet.json` — the `editor.customToolbarItems` entry to merge.
- `install.sh` — copies the script into the sandbox container
  `~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/` and prints the
  settings-merge instructions; idempotent.
- `README.md` — install, configure (theme names via `extension.themeToggle`),
  toolbar setup, scope/limitations, uninstall.
- `.gitignore` — sensible defaults.

## Testing

- Manual verification in MarkEdit: install, add the toolbar item, confirm the
  button swaps light↔dark live, the menu item shows the checkmark in dark, and
  the keyboard shortcut (if assigned) works.
- Static check: the script must not throw when `window.webModules` is absent
  (guard path), verifiable by loading the toggle function in isolation with a
  stubbed `MarkEdit`/`window`.

## Known risk

`window.webModules` is an internal MarkEdit interface, not part of the public
MarkEdit-api, so it could change across versions. It is the only live theme-swap
path and is exactly what the app uses internally. Mitigated with a runtime guard
and a clear alert if the interface is missing.

## Update (2026-06-18) — post-implementation corrections

Two assumptions in this spec were wrong against a live MarkEdit and were corrected:

1. **API access.** The `scripts/` runtime delivers the API as a CommonJS module
   (`require("markedit-api").MarkEdit`), not a bare `MarkEdit` global. The script
   and the `node:vm` test harness were corrected to model `require`.
2. **Toolbar binding.** A toolbar item invokes a JS-registered menu item via
   `actionName` (matched against the menu item title by
   `NSApp.mainMenu.firstActionNamed`), not `menuName`. The settings snippet uses
   `actionName: "Toggle Light/Dark Theme"`.

**Preview-mode limitation (confirmed by source review).** The Markdown preview pane
(`markedit-preview`) themes itself off `prefers-color-scheme` (native window
appearance), independent of the editor theme this script controls. JS cannot change
`prefers-color-scheme`. The unified light/dark lever is the native UserDefaults
`general.appearance` (drives `editor.light-theme`/`editor.dark-theme` selection and
the preview via `NSApp.effectiveAppearance`), but it is **not** reachable from a
user script: the native bridge is notify-only, there is no appearance menu command
for a toolbar `actionName` to invoke, and the sandbox cannot write app preferences.
Decision: this button stays an editor-theme toggle; full swaps use **Settings →
General → Appearance**. Documented in the README.
