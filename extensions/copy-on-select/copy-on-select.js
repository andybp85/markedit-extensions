/*
 * MarkEdit Copy on Select
 * Copies the selected text to the clipboard when a mouse selection ends.
 * Drop this file into MarkEdit's `scripts/` directory.
 *
 * API: https://github.com/MarkEdit-app/MarkEdit/wiki/Customization#markedit-api
 */
;(() => {
    'use strict'

    // In MarkEdit's scripts/ runtime the API and the CodeMirror modules are
    // CommonJS modules, not globals.
    const { MarkEdit } = require('markedit-api')
    const { EditorView } = require('@codemirror/view')

    const MENU_TITLE = 'Copy on Select'
    const SETTINGS_KEY = 'extension.copyOnSelect'
    const SETTINGS_FILE = 'settings.json'

    const PARSE_FAILURE =
        `${SETTINGS_FILE} could not be read, so the setting was not saved. ` +
        'Correct the file, or the toggle will reset when you quit MarkEdit.'
    const READ_FAILURE = `${SETTINGS_FILE} could not be opened, so the setting was not saved. The toggle will reset when you quit MarkEdit.`
    const WRITE_FAILURE = `${SETTINGS_FILE} could not be written, so the setting was not saved. The toggle will reset when you quit MarkEdit.`

    let enabled = MarkEdit.userSettings?.[SETTINGS_KEY]?.enabled ?? true

    // The text of the last write. A repeat of it is skipped, which stops a
    // clipboard manager from filling with identical entries, and which makes the
    // two mouseup handlers below safe to overlap.
    let lastCopied = ''

    // True between a mousedown and a mouseup inside the editor content. The
    // backstop on document copies only for such a gesture, so a mouseup on the
    // gutter or a panel never copies a keyboard selection.
    let mouseSelecting = false

    // One alert for each session. A user who toggles the item against a broken
    // file does not need one alert for each attempt.
    let alerted = false

    // Join every non-empty range, the way Command-C does for a multi-cursor
    // selection, so the extension and the key produce the same text.
    const selectedText = state =>
        state.selection.ranges
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
            // A later selection can already own the record, and that write did not
            // fail, so clear the record only when it still holds this text.
            if (lastCopied === text) lastCopied = ''
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

    const parseSettings = raw => {
        try {
            return JSON.parse(raw)
        } catch {
            return undefined
        }
    }

    // Proof that the file is not there, which only a successful listing gives. A
    // listing that fails, or that holds the file, proves nothing.
    const settingsAbsent = async directory => {
        const listing = await MarkEdit.listFiles(directory)
        return Array.isArray(listing) && !listing.some(entry => entry === SETTINGS_FILE || entry.endsWith(`/${SETTINGS_FILE}`))
    }

    // Read, merge one key, write back, so every unrelated setting survives. Each
    // half has its own try/catch: a rejected API call is a failure of that half,
    // and it must alert with that message instead of escaping as an unhandled
    // rejection.
    const persistEnabled = async () => {
        let path
        let settings = {}

        try {
            const directory = MarkEdit.getDirectoryPath('documents')
            path = `${directory}/${SETTINGS_FILE}`
            const raw = await MarkEdit.getFileContent(path)

            if (typeof raw !== 'string') {
                // The API returns undefined when the read fails, not when the file is
                // absent. A write now could replace a real settings.json with this one
                // key, so refuse until a listing proves that the file is not there.
                if (!(await settingsAbsent(directory))) {
                    alertOnce(READ_FAILURE)
                    return
                }
            } else if (raw.trim() !== '') {
                const parsed = parseSettings(raw)
                if (!isPlainObject(parsed)) {
                    // Writing now would replace every MarkEdit setting with this one key.
                    alertOnce(PARSE_FAILURE)
                    return
                }
                settings = parsed
            }
        } catch {
            alertOnce(READ_FAILURE)
            return
        }

        try {
            const current = isPlainObject(settings[SETTINGS_KEY]) ? settings[SETTINGS_KEY] : {}
            const merged = { ...settings, [SETTINGS_KEY]: { ...current, enabled } }
            const written = await MarkEdit.createFile({ overwrites: true, path, string: JSON.stringify(merged, null, 2) })
            if (!written) alertOnce(WRITE_FAILURE)
        } catch {
            alertOnce(WRITE_FAILURE)
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
        title: MENU_TITLE,
    })

    // CodeMirror attaches these to the editor content only. A handler that
    // returns true suppresses CodeMirror's own handling, so both use a block body
    // and return undefined.
    MarkEdit.addExtension(
        EditorView.domEventHandlers({
            mousedown: event => {
                mouseSelecting = event.button === 0
            },
            mouseup: (event, view) => {
                mouseSelecting = false
                if (event.button === 0) copySelection(view)
            },
        }),
    )

    // A drag that ends outside the editor never reaches the handler above. This
    // one catches it. Both can run for one gesture, which the skip rule in
    // copySelection makes harmless. The gesture must have started in the editor
    // content: a mouseup on the gutter, on a panel, or from another button would
    // otherwise copy a keyboard selection.
    document.addEventListener('mouseup', event => {
        if (!mouseSelecting || event.button !== 0) return
        mouseSelecting = false
        copySelection(MarkEdit.editorView)
    })

    // Another app or Command-C can replace the clipboard, so the record is no
    // longer evidence of what is on it.
    document.addEventListener('copy', () => {
        lastCopied = ''
    })
    window.addEventListener('blur', () => {
        lastCopied = ''
    })
})()
