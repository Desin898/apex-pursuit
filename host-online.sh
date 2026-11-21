#!/bin/sh
# Apex Pursuit — host an online race (macOS / Linux).
# Playing solo needs nothing: open play/ApexPursuit.html. Joining a friend needs nothing: open their link.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed to host an online race. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
if [ ! -d node_modules/ws ]; then
  echo "Setting up for the first time (one small download)..."
  npm install --omit=dev --no-audit --no-fund || exit 1
fi
exec node server/host.mjs "$@"
