#!/usr/bin/env bash
#
# Install MarkEdit extensions into MarkEdit's script sandbox.
#
#   ./install.sh              install every extension
#   ./install.sh toggle-dark  install only the named extension(s)
#
# Each directory under extensions/ is one extension. Its top-level *.js files
# are the drop-in scripts; test/ and documentation stay behind.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSIONS_DIR="$REPO_DIR/extensions"
MARKEDIT_DOCS="${MARKEDIT_DOCS:-$HOME/Library/Containers/app.cyan.markedit/Data/Documents}"
SCRIPTS_DIR="$MARKEDIT_DOCS/scripts"

die() {
    echo "install.sh: $1" >&2
    exit 1
}

# Print the name of every extension directory, one per line.
all_extensions() {
    for dir in "$EXTENSIONS_DIR"/*/; do
        [ -d "$dir" ] || continue
        basename "$dir"
    done
}

# Copy one extension's top-level scripts into the sandbox.
install_extension() {
    local name="$1"
    local dir="$EXTENSIONS_DIR/$name"

    local found=0
    for script in "$dir"/*.js; do
        [ -f "$script" ] || continue
        cp "$script" "$SCRIPTS_DIR/$(basename "$script")"
        echo "  $name: installed $(basename "$script") -> $SCRIPTS_DIR/"
        found=1
    done
    [ "$found" -eq 1 ] || die "extension $name has no top-level .js script"

    if [ -f "$dir/settings.snippet.json" ]; then
        echo "  $name: merge $dir/settings.snippet.json into $MARKEDIT_DOCS/settings.json"
    fi
}

[ -d "$EXTENSIONS_DIR" ] || die "extensions directory not found: $EXTENSIONS_DIR"

if [ "$#" -gt 0 ]; then
    targets=("$@")
else
    # Extension directory names never contain whitespace.
    # shellcheck disable=SC2207
    targets=($(all_extensions))
fi
[ "${#targets[@]}" -gt 0 ] || die "no extensions found in $EXTENSIONS_DIR"

# Validate every name up front so a typo in the second argument cannot leave
# the sandbox half-installed.
for name in "${targets[@]}"; do
    [ -d "$EXTENSIONS_DIR/$name" ] ||
        die "no such extension: $name (available: $(all_extensions | tr '\n' ' '))"
done

mkdir -p "$SCRIPTS_DIR"
for name in "${targets[@]}"; do
    install_extension "$name"
done

echo ""
echo "Then restart MarkEdit."
