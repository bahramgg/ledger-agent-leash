# Running against a real Speculos device

By default the demo runs with a **mock signer** (`USE_MOCK_SIGNER=true`) so it
works anywhere. This guide shows how to run the *same* code against
[Speculos](https://github.com/LedgerHQ/speculos), Ledger's official device
emulator, so the signer talks to an emulated Ledger running the real Solana app.

> Speculos is an emulator — a faithful stand-in for a physical Ledger so you can
> run without hardware. It is not a substitute for a real secure element in
> production.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running.
- This repo set up: `npm install`.

## 1. Start Speculos with the Solana app

The simplest path is the official Docker image, which exposes Speculos' HTTP/APDU
endpoint on port `5000`.

```bash
docker run --rm -it \
  -p 5000:5000 \
  ghcr.io/ledgerhq/speculos \
  --model nanosp \
  --display headless \
  --api-port 5000 \
  /speculos/apps/solana.elf
```

Notes:

- `-p 5000:5000` maps the container's API port to `http://localhost:5000`, which
  is exactly where this project's Speculos transport connects.
- `--display headless` runs without a GUI window and is ideal for screen
  recording or CI; drop it (and add the appropriate X11/VNC flags) if you want
  to watch the device screen.
- `--model nanosp` selects a Nano S+. Other values: `nanox`, `stax`, `flex`.
- `/speculos/apps/solana.elf` is the Solana app inside the image. If your image
  ships the apps elsewhere, or you want a specific version, mount your own app
  build and point to it:
  `-v $PWD/apps:/apps ... /apps/solana.elf`. App builds come from
  [LedgerHQ/app-solana](https://github.com/LedgerHQ/app-solana).

You can confirm Speculos is up by checking that something answers on the API
port (for example, `curl http://localhost:5000/events` returns a stream).

## 2. Point the project at Speculos

The Speculos URL is read from the environment (defaults to
`http://localhost:5000`). Copy the example env file if you haven't already:

```bash
cp .env.example .env
```

Relevant settings in `.env`:

```bash
USE_MOCK_SIGNER=false          # use the real Speculos-backed signer
SPECULOS_API_URL=http://localhost:5000
SOLANA_RPC_URL=https://api.devnet.solana.com   # devnet only
```

## 3. Run a scenario against the device

With Speculos running and `USE_MOCK_SIGNER=false` (or simply unset):

```bash
npm run demo -- --scenario safe
```

The trace will read `signer  Speculos device` instead of `MOCK (simulated)`, and
the address and signature now come from the emulated Ledger rather than the mock.

The `over-limit` and `attack` scenarios behave identically with the real signer —
because they are **blocked by the leash before the signer is ever called**, the
device is never even asked to sign. That is the whole point.

## Optional: automating on-device confirmation

Reading an address with `CHECK_ADDRESS_ON_DEVICE=true`, and signing, require a
button press on the device screen. Speculos can be driven programmatically (its
API accepts button events and serves screenshots), and the
`@ledgerhq/speculos-device-controller` package — already a dependency — is built
for exactly this. Wiring automated approval into the signing flow is a natural
next step for an end-to-end, hands-free recording.

## Troubleshooting

- **`Could not reach Speculos at http://localhost:5000`** — Speculos isn't
  running, the port isn't mapped, or `SPECULOS_API_URL` points elsewhere.
- **Connects but signing/app errors** — make sure the app you launched is the
  **Solana** app; this project derives `44'/501'/0'/0'` and uses the Solana
  signer kit.
- **Port already in use** — map a different host port (e.g. `-p 5050:5000`) and
  set `SPECULOS_API_URL=http://localhost:5050`.
