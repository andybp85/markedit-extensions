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
  const SETTINGS_FILE = 'settings.json'

  let enabled = MarkEdit.userSettings?.[SETTINGS_KEY]?.enabled ?? true

  // The text of the last write. A repeat of it is skipped, which stops a
  // clipboard manager from filling with identical entries, and which makes the
  // two mouseup handlers below safe to overlap.
  let lastCopied = ''

  // One alert for each session. A user who toggles the item against a broken
  // file does not need one alert for each attempt.
  let alerted = false

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

  // typeof null is 'object', so the null test is not redundant. JSON.parse is
  // what produces null here; the rest of the file uses undefined.
  const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

  const alertOnce = message => {
    if (alerted) return
    alerted = true
    MarkEdit.showAlert({ message, title: MENU_TITLE })
  }

  // Read, merge one key, write back, so every unrelated setting survives. The
  // outer try/catch is not part of the refuse-to-write logic below: it only
  // catches getFileContent/createFile rejecting outright, which is a failed
  // write same as a falsy result, and must alert the same way instead of
  // escaping as an unhandled rejection.
  const persistEnabled = async () => {
    try {
      const path = `${MarkEdit.getDirectoryPath('documents')}/${SETTINGS_FILE}`
      const raw = await MarkEdit.getFileContent(path)

      let settings = {}
      if (typeof raw === 'string' && raw.trim() !== '') {
        try {
          settings = JSON.parse(raw)
        } catch {
          settings = undefined
        }
        if (!isPlainObject(settings)) {
          // Writing now would replace every MarkEdit setting with this one key.
          alertOnce(
            `${SETTINGS_FILE} could not be read, so the setting was not saved. ` +
            'Correct the file, or the toggle will reset when you quit MarkEdit.'
          )
          return
        }
      }

      const current = isPlainObject(settings[SETTINGS_KEY]) ? settings[SETTINGS_KEY] : {}
      settings[SETTINGS_KEY] = { ...current, enabled }

      const written = await MarkEdit.createFile({ overwrites: true, path, string: JSON.stringify(settings, null, 2) })
      if (!written)
        alertOnce(`${SETTINGS_FILE} could not be written, so the setting was not saved. The toggle will reset when you quit MarkEdit.`)
    } catch {
      alertOnce(`${SETTINGS_FILE} could not be written, so the setting was not saved. The toggle will reset when you quit MarkEdit.`)
    }
  }

  const toggle = () => {
    enabled = !enabled
    // Forget the last write, so the first selection after a restart of the
    // extension always reaches the clipboard.
    lastCopied = ''
    void persistEnabled()
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

  // A drag that ends outside the editor never reaches the handler above. This
  // one catches it. Both can run for one gesture, which the skip rule in
  // copySelection makes harmless.
  document.addEventListener('mouseup', () => copySelection(MarkEdit.editorView))
})()
