# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The public interface of this repository is the layout of an extension directory,
the command-line interface of `install.sh`, and the `settings.json` keys that the
extensions read.

## [Unreleased]

## [1.2.0] - 2026-08-30

### Added

- `extensions/color-highlight`: paints hex, `rgb()` and `hsl()` colour tokens with the colour they name, and sets the
  text of the token to black or white by WCAG relative luminance. A hex token that opens a line is left alone, because
  that position belongs to a Markdown heading. A menu item turns the extension on and off, and the state is kept in the
  `extension.colorHighlight` key of `settings.json`.

## [1.1.0] - 2026-08-06

### Added

- `extensions/copy-on-select`: copies the selected text to the clipboard when a
  mouse selection ends. Keyboard selections never copy. A menu item turns the
  extension on and off, and the state is kept in the `extension.copyOnSelect`
  key of `settings.json`.
- `test/repo.test.mjs` holds the repository invariants. Every extension must
  have a README, a top-level script, and a test directory. The root README must
  list every extension, and the changelog must document the version in
  `package.json`.

## [1.0.0] - 2026-08-06

First versioned release. The repository became a home for more than one MarkEdit
extension, so the single-extension project moved under `extensions/`.

### Added

- `extensions/toggle-dark`: a toolbar button and menu item that swap the editor
  between the configured light and dark themes, live. Set the pair with the
  `extension.themeToggle` key in `settings.json`.
- `install.sh` installs every extension, or only the extensions that you name:
  `./install.sh toggle-dark`. It validates every name before it copies anything.
- `package.json` with `npm test`, which runs `node --test` over the repository.
- Tests for the installer under `test/`.

### Changed

- The repository holds many extensions. Each one lives in `extensions/<name>/`,
  with its own README, its drop-in scripts at the top level, and its tests in
  `test/`.
- `theme-toggle.js` now uses `const`, arrow functions, and optional chaining.
  The behavior is the same.

<!-- No remote is configured, so the version headings carry no compare links. -->
