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

  const MENU_TITLE = 'Copy on Select'
  const SETTINGS_KEY = 'extension.copyOnSelect'

  let enabled = MarkEdit.userSettings?.[SETTINGS_KEY]?.enabled ?? true

  // The text of the last write. A repeat of it is skipped, which stops a
  // clipboard manager from filling with identical entries, and which makes the
  // two mouseup handlers below safe to overlap.
  let lastCopied = ''

  // Join every non-empty range, the way Command-C does for a multi-cursor
  // selection, so the extension and the key produce the same text.
  const selectedText = state => state.selection.ranges
    .filter(range => !range.empty)
    .map(range => state.sliceDoc(range.from, range.to))
    .join('\n')

  const copySelection = view => {
    if (!enabled || !view) return
    const text = selectedText(view.state)
    if (text === '' || text === lastCopied) return

    // Record before the write, not after. The write is asynchronous, so both
    // handlers could otherwise pass this test for one gesture and write twice.
    lastCopied = text
    navigator.clipboard.writeText(text).catch(error => {
      lastCopied = ''
      // This can run for every selection, so an alert here would be unusable.
      console.warn('copy-on-select: could not write to the clipboard.', error)
    })
  }

  const toggle = () => {
    enabled = !enabled
    // Forget the last write, so the first selection after a restart of the
    // extension always reaches the clipboard.
    lastCopied = ''
  }

  MarkEdit.addMainMenuItem({
    action: toggle,
    state: () => ({ isSelected: enabled }),
    title: MENU_TITLE
  })

  MarkEdit.addExtension(EditorView.domEventHandlers({
    // A handler that returns true suppresses CodeMirror's own handling, so this
    // uses a block body and returns undefined.
    mouseup: (event, view) => { copySelection(view) }
  }))
})()
