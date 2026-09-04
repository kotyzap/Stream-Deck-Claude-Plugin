#!/bin/zsh
# One-time: create a self-signed code-signing identity "ClaudeDeck Signing" in the login keychain.
# A stable identity keeps macOS's Accessibility grant valid across rebuilds (ad-hoc signatures don't).
set -euo pipefail
NAME="ClaudeDeck Signing"
if security find-identity -v -p codesigning | grep -q "$NAME"; then echo "identity exists"; exit 0; fi
T=$(mktemp -d)
cat > "$T/cs.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$T/cs.cnf" -keyout "$T/key.pem" -out "$T/cert.pem" 2>/dev/null
openssl pkcs12 -export -inkey "$T/key.pem" -in "$T/cert.pem" -out "$T/cs.p12" -passout pass:claudedeck -legacy 2>/dev/null || \
openssl pkcs12 -export -inkey "$T/key.pem" -in "$T/cert.pem" -out "$T/cs.p12" -passout pass:claudedeck
KC="$HOME/Library/Keychains/login.keychain-db"
security import "$T/cs.p12" -k "$KC" -P claudedeck -T /usr/bin/codesign -T /usr/bin/security
# trust it for code signing (user trust domain; macOS asks for your login password once)
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" "$T/cert.pem"
rm -rf "$T"
security find-identity -v -p codesigning
