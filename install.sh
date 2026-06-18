#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKEDIT_DOCS="${MARKEDIT_DOCS:-$HOME/Library/Containers/app.cyan.markedit/Data/Documents}"
SCRIPTS_DIR="$MARKEDIT_DOCS/scripts"

mkdir -p "$SCRIPTS_DIR"
cp "$SRC_DIR/scripts/theme-toggle.js" "$SCRIPTS_DIR/theme-toggle.js"
echo "Installed theme-toggle.js -> $SCRIPTS_DIR/theme-toggle.js"

echo ""
echo "Next, add the toolbar button. Merge settings.snippet.json into:"
echo "  $MARKEDIT_DOCS/settings.json"
echo "specifically the \"editor.customToolbarItems\" array (see settings.snippet.json)."
echo "Then restart MarkEdit. Optionally set your theme names in settings.json:"
echo '  "extension.themeToggle": { "light": "github-light", "dark": "github-dark" }'
