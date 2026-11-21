#!/bin/sh
# Apex Pursuit — host an online race (macOS / Linux). Playing solo needs nothing: open play/ApexPursuit.html
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed to host an online race. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
if [ ! -d node_modules/ws ]; then
  echo "Setting up for the first time (one small download)..."
  npm install --omit=dev --no-audit --no-fund || exit 1
fi
echo "Starting the race server. Keep this window open while you play."
echo "Friends on the same Wi-Fi: open the 'Same network' address below in Chrome or Edge."
( sleep 1; (command -v open >/dev/null && open "http://localhost:8080/?room=friends") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:8080/?room=friends") ) >/dev/null 2>&1 &
exec node server/relay.mjs
