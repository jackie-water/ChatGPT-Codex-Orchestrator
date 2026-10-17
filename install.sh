#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
LANGUAGE="en"
COMMAND="dry-run"
while [[ $# -gt 0 ]]; do case "$1" in --language) LANGUAGE="${2:-en}"; shift 2;; --setup) COMMAND="setup"; shift;; --resume) COMMAND="resume"; shift;; *) shift;; esac; done
case "$LANGUAGE" in en|zh-CN) ;; *) LANGUAGE="en";; esac
if [[ "$(uname -s)" != "Darwin" ]]; then echo "This installer is for macOS (此安装程序用于 macOS)。" >&2; exit 2; fi
node "$ROOT/src/cli.mjs" dry-run --json --language "$LANGUAGE"
if [[ "$COMMAND" != "dry-run" ]]; then exec node "$ROOT/src/cli.mjs" "$COMMAND" --json --language "$LANGUAGE"; fi
