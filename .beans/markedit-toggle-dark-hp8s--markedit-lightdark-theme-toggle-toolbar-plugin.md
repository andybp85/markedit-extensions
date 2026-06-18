---
# markedit-toggle-dark-hp8s
title: MarkEdit light/dark theme toggle toolbar plugin
status: in-progress
type: feature
created_at: 2026-06-18T12:46:13Z
updated_at: 2026-06-18T12:46:13Z
---

MarkEdit user-script plugin: a toolbar button that swaps the editor between light and dark themes. Uses MarkEdit-api addExtension + addMainMenuItem; toolbar item wired via settings.json editor.customToolbarItems (menuName). No native appearance API exists, so theming is scoped to the CodeMirror editor surface via a theme Compartment reconfigure.
