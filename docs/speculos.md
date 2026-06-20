# Running against a real Speculos device

By default the demo uses a **mock signer** (`USE_MOCK_SIGNER=true`) so it runs
anywhere. This guide shows how to run the *same* code against
[Speculos](https://github.com/LedgerHQ/speculos), Ledger's official device
emulator, so the signer (`src/signer/speculos-signer.ts`) returns a **real
ed25519 signature** from the emulated Solana app over the DMK Speculos transport.

> Speculos is an emulator — a faithful stand-in for a physical Ledger so you can
> run without hardware. It is not a substitute for a real secure element in
> production.

The signer connects to Speculos' HTTP API at `SPECULOS_API_URL`
(default `http://localhost:5000`). The DMK Speculos transport posts APDUs to
`POST /apdu` and watches `GET /events` — exactly what Speculos serves.

## Step 0 — Get a Solana app ELF

Speculos runs a real app binary. Put a Solana app ELF at `apps/app.elf`. ELFs are
build artifacts and are git-ignored; see [`apps/README.md`](../apps/README.md) for
how to build one with Ledger's app builder. Match the build SDK to the device
model you'll emulate (default here: `nanosp`).

## Step 1 — Start Speculos

Two equivalent options. Both expose the API on port 5000.

### Option A — pip (used by the npm script)

```bash
pip install speculos          # one-time; provides the `speculos` command
npm run speculos:start        # → speculos --model nanosp --display headless \
                              #     --api-port 5000 --automation file:speculos/automation.json apps/app.elf
```

Overridable via env: `SPECULOS_MODEL` (nanosp|nanox|stax|flex), `SPECULOS_API_PORT`
(default 5000), `SPECULOS_APP` (default `apps/app.elf`).

### Option B — Docker

```bash
docker pull ghcr.io/ledgerhq/speculos:latest
docker run --rm -it -p 5000:5000 \
  -v "$(realpath apps):/apps" \
  ghcr.io/ledgerhq/speculos:latest \
  --model nanosp --display headless --api-port 5000 \
  --automation file:/apps/automation.json /apps/app.elf
```

(Copy `speculos/automation.json` into `apps/` if you use this mount, or adjust the
path.)

Confirm it's up: `curl http://localhost:5000/events` should hold open an event
stream.

### Unattended approval (automation)

Reading an address (`checkOnDevice=false`, the default) needs no button press. But
**signing requires approving on the device screen.** `speculos/automation.json`
drives the buttons for you — it navigates right and presses both buttons on any
"approve / sign / confirm" screen. Screen wording varies by app version, so if a
signature stalls, tweak the regexps there. (The `@ledgerhq/speculos-device-controller`
dependency can drive the device programmatically too, if you want finer control.)

## Step 2 — Point the app at Speculos

```bash
cp .env.example .env   # if you haven't already
```

```bash
# .env
USE_MOCK_SIGNER=false                         # use the real Speculos-backed signer
SPECULOS_API_URL=http://localhost:5000
SOLANA_RPC_URL=https://api.devnet.solana.com  # devnet only
```

## Step 3 — Run end-to-end

With Speculos running and `USE_MOCK_SIGNER=false`:

```bash
# CLI
npm run demo -- --scenario safe

# Web dashboard
npm run web        # open http://localhost:3000, run a safe transfer
```

On an ALLOWED transfer the response/trace shows `signer: Speculos device` and a
real base58 signature produced by the emulated Ledger. On a BLOCKED transfer the
leash refuses first, so the device is never asked to sign.

`POST /api/run` returns `signerKind: "speculos"` and a real `signature` whenever
the leash approves.

## Troubleshooting

- **`Could not reach Speculos at http://localhost:5000`** — Speculos isn't
  running, the port isn't mapped, or `SPECULOS_API_URL` points elsewhere.
- **Signature hangs** — the automation didn't match the approval screen; adjust
  `speculos/automation.json` regexps to the app's wording.
- **App/CLA errors on signing** — the running app isn't the **Solana** app, or the
  ELF was built for a different model than `SPECULOS_MODEL`.
- **Port already in use** — pass `SPECULOS_API_PORT=5050` and set
  `SPECULOS_API_URL=http://localhost:5050`.

## Note on this project's cloud sandbox

The hosted build environment for this repo cannot run Speculos with the Solana
app: container registries' blob CDNs are blocked / rate-limited (no image pull),
and the app builder image needed to compile an ELF is likewise unreachable. The
emulator engine installs fine via pip, but without a Solana ELF it can't emulate
the Solana app. So in the sandbox the web demo uses the mock signer; a **real**
Speculos signature is produced on a local machine (or any host with Docker + an
ELF) using the steps above. See `DEPLOY.md` for how this affects deployment.
