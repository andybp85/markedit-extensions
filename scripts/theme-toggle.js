/*
 * MarkEdit Theme Toggle
 * Swaps the editor between the configured light and dark themes.
 * Drop this file into MarkEdit's `scripts/` directory.
 *
 * API: https://github.com/MarkEdit-app/MarkEdit/wiki/Customization#markedit-api
 */
(function () {
  "use strict";

  var MENU_TITLE = "Toggle Light/Dark Theme";
  var DEFAULTS = { light: "github-light", dark: "github-dark" };

  function config() {
    var settings = (MarkEdit.userSettings && MarkEdit.userSettings["extension.themeToggle"]) || {};
    return {
      light: settings.light || DEFAULTS.light,
      dark: settings.dark || DEFAULTS.dark
    };
  }

  // Track the active theme internally so the menu checkmark stays correct
  // regardless of whether MarkEdit writes the new name back to editorConfig.
  var activeName = (MarkEdit.editorConfig && MarkEdit.editorConfig.theme) || DEFAULTS.light;

  function isDark() {
    return activeName === config().dark;
  }

  function applyTheme(name) {
    var bridge = window.webModules && window.webModules.config;
    if (!bridge || typeof bridge.setTheme !== "function") {
      MarkEdit.showAlert({
        title: "Theme Toggle unavailable",
        message: "This MarkEdit version does not expose the theme bridge used by the toggle."
      });
      return;
    }
    bridge.setTheme({ name: name });
    activeName = name;
  }

  function toggle() {
    var names = config();
    applyTheme(isDark() ? names.light : names.dark);
  }

  MarkEdit.addMainMenuItem({
    title: MENU_TITLE,
    action: toggle,
    state: function () { return { isSelected: isDark() }; }
  });
})();
