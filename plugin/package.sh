#!/bin/zsh
# Assemble the one-click installer: plugin + bundled profiles + ClaudeDeck.app (built by applet/build.sh).
#   zsh plugin/package.sh          → dist/com.4xsdev.claude.streamDeckPlugin        (Marketplace build, no Ko-fi key)
#   zsh plugin/package.sh --kofi   → dist/com.4xsdev.claude-kofi.streamDeckPlugin   (GitHub build, adds the Ko-fi key)
# Elgato's guidelines forbid donation links inside plugins, so only the GitHub build carries the Ko-fi action.
set -euo pipefail
cd "$(dirname "$0")/.."
P=com.4xsdev.claude.sdPlugin
OUT=com.4xsdev.claude.streamDeckPlugin
[ -d "$HOME/Applications/ClaudeDeck.app" ] || { echo "build the helper first: zsh applet/build.sh"; exit 1; }
rm -rf dist/$P && mkdir -p dist/$P
cp -R plugin/$P/. dist/$P/
if [[ "${1:-}" == "--kofi" ]]; then
  OUT=com.4xsdev.claude-kofi.streamDeckPlugin
  cp -R plugin/kofi/ui/. dist/$P/ui/
  cp -R plugin/kofi/imgs/. dist/$P/imgs/
  python3 - dist/$P/manifest.json plugin/kofi/action.json <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); a=json.load(open(sys.argv[2]))
m["Actions"]=[x for x in m["Actions"] if x["UUID"]!=a["UUID"]]+[a]
json.dump(m,open(sys.argv[1],"w"),indent=2,ensure_ascii=False)
PY
fi
mkdir -p dist/$P/resources
ditto "$HOME/Applications/ClaudeDeck.app" dist/$P/resources/ClaudeDeck.app
cp profile/*.streamDeckProfile dist/$P/
( cd dist && rm -f $OUT && zip -qr $OUT $P -x '*.DS_Store' )
rm -rf dist/$P
echo "dist/$OUT"
