#!/bin/zsh
# Assemble the one-click installer: plugin + bundled profile + ClaudeDeck.app (built by applet/build.sh).
# Run on macOS from anywhere:  zsh plugin/package.sh
set -euo pipefail
cd "$(dirname "$0")/.."
P=com.4xsdev.claude.sdPlugin
[ -d "$HOME/Applications/ClaudeDeck.app" ] || { echo "build the helper first: zsh applet/build.sh"; exit 1; }
rm -rf dist/$P && mkdir -p dist/$P
cp -R plugin/$P/. dist/$P/
mkdir -p dist/$P/resources
ditto "$HOME/Applications/ClaudeDeck.app" dist/$P/resources/ClaudeDeck.app
cp profile/Claude.streamDeckProfile dist/$P/Claude.streamDeckProfile
( cd dist && rm -f com.4xsdev.claude.streamDeckPlugin && zip -qr com.4xsdev.claude.streamDeckPlugin $P -x '*.DS_Store' )
rm -rf dist/$P
echo "dist/com.4xsdev.claude.streamDeckPlugin"
