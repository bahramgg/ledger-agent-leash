# Real signatures on Railway (hosted Speculos)

This guide deploys **two services in one Railway project** so the dashboard
produces a **real, live ed25519 signature** that *you* approve from a browser:

1. **`app`** — the Node dashboard/API (this repo root).
2. **`speculos`** — a Docker service running the Ledger **Solana** app and serving
   the Speculos REST API + web UI on port `5000`.

The mock signer stays the **default**, so a plain deploy still works with no
Speculos. Real mode is opt-in via env vars. Nothing fake is ever labelled real:
a mock sig is shown as `simulated`, a captured one as `Speculos · captured`, and
only a live device sig is `Speculos · live`.

> **Honesty / safety:** Speculos runs the **TEST seed** (a well-known seed, not a
> secret) and we point Solana at **devnet**. There are **no mainnet keys and no
> real funds** anywhere in this setup. It is a demonstration of the policy leash
> producing a genuine device signature — not custody of value.

---

## Before you start — provide the Solana app ELF

Put the Ledger Solana app binary at **`infra/speculos/solana.elf`** (you supply
it — it is not fetched for you). It is git-ignored by default. For the Speculos
service to build on Railway, commit it explicitly to the deployed repo/branch:

```bash
git add -f infra/speculos/solana.elf
git commit -m "Add Solana app ELF for the Speculos service"
```

It is a public test-app binary used with the test seed on devnet — no secrets.

---

## Service A — the Speculos emulator

1. **New → Empty Service** in your Railway project, name it `speculos`.
2. Source: this repo. Set **Root Directory = `infra/speculos`** so Railway builds
   from `infra/speculos/Dockerfile` (it `COPY`s `solana.elf` into the image).
3. **Networking → Generate Domain.** Railway maps it to the container's port
   `5000`. Note the public URL, e.g. `https://speculos-production.up.railway.app`.
4. **Settings → Watch Paths = `infra/speculos/**`** so this service does **not**
   redeploy every time you push app code (and so it doesn't wipe device settings;
   see below).
5. Deploy. Open the public URL — you should see the Speculos web UI with the
   Solana app running on an emulated Nano S+.

### Clear signing (the default — leave blind signing OFF)

A plain SOL transfer is **clear-signed**: the device shows `Transfer`, the amount,
and the recipient, so you approve exactly what you see — **no blind signing
required.** Keep **Solana app → Settings → Blind signing = NOT Allowed**. This is
the Ledger-recommended behaviour and matches what the app does for a standard
`System Program: Transfer`.

Blind signing only enters the picture if a sign is *refused* with status
`0x6a81` — that means the app couldn't parse the transaction (a malformed message
or an unusual app build), not a normal transfer. As a last-resort fallback you
could enable Blind signing, but the right fix is a clear-signable transaction / a
stable app build. (Speculos device settings reset on every redeploy.)

---

## Service B — the Node app

1. **New → Service → from this repo**, root directory = repo root.
2. **Build command:** `npm install && npm run build`
   (Railway uses `npm ci` by default, which needs `package-lock.json` perfectly
   in sync. This project adds **no new runtime deps**, so the lockfile is already
   in sync — but setting the build command to `npm install && npm run build`
   avoids the `npm ci` failure mode entirely if you ever add a dep.)
3. **Start command:** `npm start` (serves `dist/server.cjs`; `PORT` is provided
   by Railway and read automatically).
4. **Variables** (Service B):

   | Variable | Value | Why |
   |---|---|---|
   | `USE_MOCK_SIGNER` | `false` | Turn on the real signer (mock is the default). |
   | `SPECULOS_URL` | `https://<your-speculos>.up.railway.app` | Server-side APDU endpoint. **Use the PUBLIC https URL** — Railway private networking is IPv6 and Speculos binds IPv4 only, so `*.railway.internal` will NOT reach it. |
   | `SPECULOS_PUBLIC_URL` | same public URL | The "open the signer to approve" link shown in the dashboard. |
   | `SPECULOS_SIGNER` | `http` | Optional. The signer auto-selects DMK locally and HTTP for a remote https Speculos, so on Railway it already uses HTTP; set `http` explicitly if you want to be sure. |
   | `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Devnet only — used to fetch a recent blockhash. |
   | `SPECULOS_SIGN_TIMEOUT_MS` | `120000` | How long a request waits for your approval before timing out. |

5. Deploy.

---

## Use real 32-byte addresses

The built-in demo addresses (e.g. `7xKX…`) are illustrative placeholders and are
**not** valid 32-byte Solana keys — in real mode the server will reject them with
a clear error ("destination address did not decode to 32 bytes"). For a real
signature, use real devnet pubkeys in the composer:

- **Allowed destination** and **Destination address**: a valid 32-byte base58
  pubkey. The simplest choice is the **device's own address** — it is guaranteed
  valid; you can read it from Speculos or from a quick `getAddress` call. Any
  real devnet account address works too.

(The "Launch attack" button is blocked by the leash before any signing, so it
never needs a valid address.)

---

## Approving a signature (the flow)

1. Open the **app** public URL. In real mode the dashboard fetches `/api/mode`
   and knows a device approval is expected.
2. Run an **allowed** transfer (within cap, allowlisted, real 32-byte address).
   The leash approves, the server builds the real Solana transfer (recent
   blockhash from devnet) and sends it to Speculos.
3. The dashboard shows **"awaiting approval — open the signer to approve"** with a
   link to `SPECULOS_PUBLIC_URL`. Open it and **approve on the emulated device**.
4. The dashboard then shows the **real base58 signature**, badged
   **`Speculos · live`**. On failure it shows the **real error detail** (e.g.
   blind signing disabled, or a timeout) — never a fake fallback labelled real.

A **blocked** transfer (over cap or not allowlisted) returns immediately and the
device is never asked to sign.

---

## Troubleshooting

- **`Could not reach Speculos at …/apdu`** — `SPECULOS_URL` is wrong or you used
  the internal `*.railway.internal` host (IPv6). Use the public https URL.
- **Status `0x6a81` / signing refused** — the app couldn't clear-sign (parse) the
  transaction. For a standard transfer this shouldn't happen; check the tx is a
  plain `System Program: Transfer` and the app build is stable. Enabling Blind
  signing is only a last-resort fallback, not the intended path.
- **Timed out waiting for approval** — you didn't approve within
  `SPECULOS_SIGN_TIMEOUT_MS`; approve in the Speculos UI, or raise the timeout.
- **"did not decode to 32 bytes"** — use a real 32-byte base58 address (see
  above); the demo placeholders aren't real keys.
- **App/CLA errors** — the running app isn't the **Solana** app, or the ELF was
  built for a different model than the Dockerfile's `--model nanosp`.
- **Speculos redeployed unexpectedly** — set **Watch Paths = `infra/speculos/**`**
  on the `speculos` service.

---

## Local equivalent

Everything above works locally too: run Speculos (`docs/speculos.md`), then
`USE_MOCK_SIGNER=false SPECULOS_URL=http://localhost:5000 SPECULOS_PUBLIC_URL=http://localhost:5000 npm start`.
