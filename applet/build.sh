#!/bin/zsh
# Builds ClaudeDeck.app from ClaudeDeck.applescript and installs it to ~/Applications.
# Run on macOS:  zsh build.sh
set -euo pipefail
cd "$(dirname "$0")"
OUT="$HOME/Applications/ClaudeDeck.app"
mkdir -p "$HOME/Applications"
rm -rf "$OUT" build && mkdir build
osacompile -o build/ClaudeDeck.app ClaudeDeck.applescript
swiftc -O -o build/ClaudeDeck.app/Contents/MacOS/axpress axpress.swift
P=build/ClaudeDeck.app/Contents/Info.plist
pb() { /usr/libexec/PlistBuddy -c "Set $1 $3" "$P" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add $1 $2 $3" "$P"; }
pb :CFBundleIdentifier string dev.4xs.claudedeck
pb :CFBundleName string ClaudeDeck
pb :CFBundleShortVersionString string 1.0.0
pb :LSUIElement bool true
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes array' "$P"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0 dict' "$P"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLName string dev.4xs.claudedeck' "$P"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' "$P"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string claudedeck' "$P"
pb :NSAppleEventsUsageDescription string 'ClaudeDeck presses buttons in the Claude app for your Stream Deck.'
[ -f ClaudeDeck.icns ] && cp ClaudeDeck.icns build/ClaudeDeck.app/Contents/Resources/applet.icns
# Sign with the stable self-signed identity from make-signing-cert.sh; ad-hoc fallback loses the Accessibility grant on every rebuild.
if security find-identity -v -p codesigning | grep -q "ClaudeDeck Signing"; then SIGN="ClaudeDeck Signing"; else SIGN="-"; echo "WARNING: ad-hoc signing (run make-signing-cert.sh once)"; fi
codesign --force --deep --sign "$SIGN" build/ClaudeDeck.app
mv build/ClaudeDeck.app "$OUT"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$OUT"
echo "Installed: $OUT"
echo "Test:      open 'claudedeck://inspect'   (then approve the Accessibility prompt once)"
echo "Log:       tail -f ~/Library/Logs/ClaudeDeck.log"
