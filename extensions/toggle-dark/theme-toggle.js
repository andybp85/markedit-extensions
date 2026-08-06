/*
 * MarkEdit Theme Toggle
 * Swaps the editor between the configured light and dark themes.
 * Drop this file into MarkEdit's `scripts/` directory.
 *
 * API: https://github.com/MarkEdit-app/MarkEdit/wiki/Customization#markedit-api
 */
(() => {
  'use strict'

  // In MarkEdit's scripts/ runtime the API is a CommonJS module, not a global.
  const { MarkEdit } = require('markedit-api')

  const MENU_TITLE = 'Toggle Light/Dark Theme'
  const DEFAULTS = { dark: 'github-dark', light: 'github-light' }

  const themeNames = () => {
    const settings = MarkEdit.userSettings?.['extension.themeToggle'] ?? {}
    return { dark: settings.dark || DEFAULTS.dark, light: settings.light || DEFAULTS.light }
  }

  // Track the active theme here so the menu checkmark stays correct regardless
  // of whether MarkEdit writes the new name back to editorConfig.
  let activeName = MarkEdit.editorConfig?.theme || DEFAULTS.light

  const isDark = () => activeName === themeNames().dark

  const applyTheme = name => {
    // MarkEdit exposes no public theme setter; this internal bridge is the same
    // one the app itself calls, so guard against it disappearing across versions.
    const bridge = window.webModules?.config
    if (typeof bridge?.setTheme !== 'function') {
      MarkEdit.showAlert({
        message: 'This MarkEdit version does not expose the theme bridge used by the toggle.',
        title: 'Theme Toggle unavailable'
      })
      return
    }
    bridge.setTheme({ name })
    activeName = name
  }

  const toggle = () => {
    const { dark, light } = themeNames()
    applyTheme(isDark() ? light : dark)
  }

  MarkEdit.addMainMenuItem({
    action: toggle,
    state: () => ({ isSelected: isDark() }),
    title: MENU_TITLE
  })
})()
