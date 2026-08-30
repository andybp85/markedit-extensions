---
# markedit-extensions-7hqk
title: 'color-highlight extension: paint hex/rgb/hsl colors in the editor'
status: in-progress
type: feature
created_at: 2026-08-30T18:16:34Z
updated_at: 2026-08-30T18:16:34Z
---

MarkEdit extension that paints CSS color tokens (#hex 3/4/6/8, rgb()/rgba(), hsl()/hsla()) with the color as background and black or white text chosen by WCAG relative luminance.

Approved design: pure core (findCandidates / parseColor / contrastColor) + thin CodeMirror ViewPlugin shell over visibleRanges. Menu toggle "Highlight Colors" persisted to settings.json under extension.colorHighlight, mirroring copy-on-select.

## Todo

- [ ] Write design spec to docs/superpowers/specs/2026-08-30-color-highlight-design.md
- [ ] Spec self-review
- [ ] User reviews spec
- [ ] Write implementation plan
- [ ] Implement
