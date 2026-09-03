---
# markedit-extensions-zn0u
title: Investigate color-highlight support in MarkEdit preview mode
status: todo
type: task
priority: low
created_at: 2026-08-30T21:04:52Z
updated_at: 2026-08-30T21:04:52Z
---

Color swatches from the color-highlight extension do not appear in MarkEdit's preview. This is expected given the current design, not a regression — but worth investigating whether preview support is reachable at all.

## Why it does not work today

`extensions/color-highlight/color-highlight.js` is a single CodeMirror `ViewPlugin` registered through `MarkEdit.addExtension` (line 317). It emits `Decoration.mark` ranges that CodeMirror paints onto the spans it draws for the raw source text.

- Decorations are scoped to an `EditorView`. Preview renders parsed Markdown into a separate DOM with no `EditorView`, no `visibleRanges`, no `RangeSetBuilder`.
- `findColors` scans raw source lines via `view.state.doc.lineAt(pos).text`. The `opensLine` / `leadRefusesHex` heuristics exist because the input is unparsed Markdown where `#abc` may be a heading; in preview that ambiguity is already resolved into real elements.
- `editorBackground` walks up from `view.contentDOM`, which does not exist in preview.

## Todo

- [ ] Check the MarkEdit API wiki for any preview lifecycle or render hook exposed to `scripts/` extensions
- [ ] If a hook exists, prototype a DOM pass over the rendered preview that wraps color literals in text nodes
- [ ] Decide whether the shared parser (`parseColor`, `contrastColor`) can be reused across both paths without a wrong abstraction
- [ ] If no hook exists, scrap this bean and record the finding in the extension README so the limitation is documented

## Notes

Preview support would be a second implementation, not a fix to the existing one: a DOM walk over rendered output rather than a line scan over source. Feasibility depends entirely on what MarkEdit exposes — confirm that before any design work.
