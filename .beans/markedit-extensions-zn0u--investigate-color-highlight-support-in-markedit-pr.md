---
# markedit-extensions-zn0u
title: Investigate color-highlight support in MarkEdit preview mode
status: completed
type: task
priority: low
created_at: 2026-08-30T21:04:52Z
updated_at: 2026-09-03T13:05:47Z
---

Color swatches from the color-highlight extension do not appear in MarkEdit's preview. This is expected given the current design, not a regression — but worth investigating whether preview support is reachable at all.

## Why it does not work today

`extensions/color-highlight/color-highlight.js` is a single CodeMirror `ViewPlugin` registered through `MarkEdit.addExtension` (line 317). It emits `Decoration.mark` ranges that CodeMirror paints onto the spans it draws for the raw source text.

- Decorations are scoped to an `EditorView`. Preview renders parsed Markdown into a separate DOM with no `EditorView`, no `visibleRanges`, no `RangeSetBuilder`.
- `findColors` scans raw source lines via `view.state.doc.lineAt(pos).text`. The `opensLine` / `leadRefusesHex` heuristics exist because the input is unparsed Markdown where `#abc` may be a heading; in preview that ambiguity is already resolved into real elements.
- `editorBackground` walks up from `view.contentDOM`, which does not exist in preview.

## Todo

- [x] Check the MarkEdit API wiki for any preview lifecycle or render hook exposed to `scripts/` extensions
- [x] If a hook exists, prototype a DOM pass over the rendered preview that wraps color literals in text nodes
- [x] Decide whether the shared parser (`parseColor`, `contrastColor`) can be reused across both paths without a wrong abstraction
- [x] If no hook exists, scrap this bean and record the finding in the extension README so the limitation is documented

## Notes

Preview support would be a second implementation, not a fix to the existing one: a DOM walk over rendered output rather than a line scan over source. Feasibility depends entirely on what MarkEdit exposes — confirm that before any design work.

## Summary of Changes

Resolved in MarkEdit-preview, not here. MarkEdit exposes no preview render hook to `scripts/`
user scripts. The preview pane is drawn by the MarkEdit-preview extension, so painting it is
that extension's job, and the work landed there instead.

`MarkEdit-preview@c0bb914` ("Follow the editor theme, and paint CSS color literals") ports this
script's parser into `src/shared/color.ts` and adds `src/features/colorHighlight.ts`, a DOM pass
over the rendered preview that wraps every color literal in a `color-literal` span. Coverage
matches the editor: hex 3/4/6/8, `rgb()`/`rgba()`, `hsl()`/`hsla()`, comma syntax and space
syntax alike. Mermaid diagrams and KaTeX math are skipped, since their text belongs to a layout
engine rather than to the document. `colorHighlight: false` under `extension.markeditPreview`
turns the painting off. `MarkEdit-preview@d2cb52a` cleared the test stub and lint fallout.

The `opensLine` / `leadRefusesHex` heuristic is left off in the preview. It guards against
Markdown headings, and the renderer has already resolved that ambiguity, so the preview paints a
literal that opens a paragraph or a table cell — the one case this script gives up.

The parser is a port, not a shared module. The two live in separate repositories, one a drop-in
user script and one a bundled TypeScript extension, and a shared package holding ~350 lines of
pure color parsing would buy coupling rather than reuse.

`extensions/color-highlight/README.md` now points preview users at MarkEdit-preview instead of
stating the limitation flatly.
