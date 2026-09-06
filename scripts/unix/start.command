#!/usr/bin/env bash

DIR="$(cd "$(dirname "$0")" && pwd)"
"${DIR}/install.sh" "$@"
STATUS=$?
echo
read -r -p "Press Enter to close..."
exit "$STATUS"
