/*
 * MarkEdit Copy on Select
 * Copies the selected text to the clipboard when a mouse selection ends.
 * Drop this file into MarkEdit's `scripts/` directory.
 *
 * API: https://github.com/MarkEdit-app/MarkEdit/wiki/Customization#markedit-api
 */
(() => {
  'use strict'

  // In MarkEdit's scripts/ runtime the API and the CodeMirror modules are
  // CommonJS modules, not globals.
  const { MarkEdit } = require('markedit-api')
  const { EditorView } = require('@codemirror/view')

  // Join every non-empty range, the way Command-C does for a multi-cursor
  // selection, so the extension and the key produce the same text.
  const selectedText = state => state.selection.ranges
    .filter(range => !range.empty)
    .map(range => state.sliceDoc(range.from, range.to))
    .join('\n')

  const copySelection = view => {
    if (!view) return
    const text = selectedText(view.state)
    if (text === '') return
    navigator.clipboard.writeText(text)
  }

  MarkEdit.addExtension(EditorView.domEventHandlers({
    // A handler that returns true suppresses CodeMirror's own handling, so this
    // uses a block body and returns undefined.
    mouseup: (event, view) => { copySelection(view) }
  }))
})()
