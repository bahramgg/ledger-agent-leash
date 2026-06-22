#!/usr/bin/env bash
#
# One command to run the full LOCAL demo with a real Speculos device:
#   - starts Speculos (the Solana app ELF) in the background on :5000
#   - then runs the web app on :3000, signing through the Ledger DMK
#
# Usage:  npm run dev:local        (Ctrl+C stops both)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ELF="$ROOT/infra/speculos/solana.elf"
if [ ! -f "$ELF" ]; then
  echo "ERROR: $ELF not found. The Solana app ELF must be present." >&2
  exit 1
fi

# Make sure the Docker daemon is up (WSL/Ubuntu has no systemd by default).
sudo service docker start >/dev/null 2>&1 || true

echo "→ starting Speculos (Solana app) on http://localhost:5000 ..."
sudo docker rm -f speculos >/dev/null 2>&1 || true
sudo docker run --rm -d --name speculos -p 5000:5000 \
  -v "$ROOT/infra/speculos:/apps" \
  ghcr.io/ledgerhq/speculos:latest \
  --model nanosp --display headless --api-port 5000 /apps/solana.elf >/dev/null

# Stop Speculos automatically when the app exits (Ctrl+C).
trap 'echo; echo "→ stopping Speculos ..."; sudo docker stop speculos >/dev/null 2>&1 || true' EXIT

# Give the emulator a moment to come up.
sleep 3

echo "→ Speculos UI : http://localhost:5000   (approve transactions here)"
echo "→ App         : http://localhost:3000"
echo

USE_MOCK_SIGNER=false \
SPECULOS_URL=http://localhost:5000 \
SPECULOS_PUBLIC_URL=http://localhost:5000 \
SPECULOS_SIGNER=auto \
SPECULOS_DEBUG=true \
npm run web
