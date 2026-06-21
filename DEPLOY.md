# Deploying the dashboard

The web app is a single Node process (`src/web/server.ts`) that serves the static
dashboard from `public/` and exposes `POST /api/run`, which runs the **real**
policy engine (`src/policy.ts`). It binds `0.0.0.0` on `process.env.PORT`, so it
drops onto any Node host.

- **Build:** `npm run build` (bundles `dist/server.cjs` — and the CLI)
- **Start:** `npm start` (runs `dist/server.cjs`)
- **Port:** read from `PORT` (the host sets this; defaults to 3000 locally)

## Want a real, live signature in the cloud?

You can run Speculos itself as a second service and produce a **live** signature
you approve from your browser. See **[docs/railway.md](docs/railway.md)** for the
two-service Railway setup (app + Speculos Docker). The rest of this page covers
the simpler single-service deploy where the live signer is the mock.

## About Speculos on a public host

Speculos emulates a Ledger by running an ARM app binary under qemu. That's a
dev/CI tool, **not** something a typical single PaaS web dyno runs (but you *can*
run it as a dedicated Docker service — see [docs/railway.md](docs/railway.md)). In
the simple single-service deploy the live signer is the **mock**
(`USE_MOCK_SIGNER=true`), and the policy engine — the part this project is
actually about — runs for real.

To still show a **real** ed25519 signature, capture one once from Speculos
locally (see [docs/speculos.md](docs/speculos.md)) and paste it into the
`SPECULOS_SIGNATURE` env var. The dashboard then displays that captured-real
signature on approved transfers, clearly labelled “Speculos · captured”, with an
honest note that it was produced at dev/build time. Leave it empty to show the
simulated signature instead. Either way, nothing is misrepresented.

## Environment variables

| Variable | Purpose | Typical value |
|---|---|---|
| `PORT` | Port to listen on | set by the host |
| `USE_MOCK_SIGNER` | Use the mock signer (required on hosts without Speculos) | `true` |
| `SPECULOS_SIGNATURE` | A real base58 signature captured from Speculos, shown on approved transfers | _(your captured sig)_ |
| `SPECULOS_SIGNATURE_NOTE` | Optional override for the note under the signature | _(optional)_ |

`SOLANA_RPC_URL` / `SPECULOS_API_URL` only matter when running the real signer
(devnet only — never mainnet).

## Railway

1. **New Project → Deploy from GitHub repo**, pick this repo.
2. Railway auto-detects Node (Nixpacks). It runs `npm run build` then `npm start`
   (a `Procfile` is included as a fallback). No custom commands needed.
3. **Variables:** add `USE_MOCK_SIGNER=true` and, optionally, `SPECULOS_SIGNATURE`.
   Railway injects `PORT` automatically.
4. Deploy. Open the generated `*.up.railway.app` URL.

### Custom domain (Railway)
- Service → **Settings → Networking → Custom Domain** → enter `app.yourdomain.com`.
- Railway shows a **CNAME** target. At your DNS provider, add a CNAME record from
  your subdomain to that target. (Apex/root domains: use your DNS provider's
  ALIAS/ANAME, or a `www` subdomain.)
- Wait for DNS to propagate; Railway provisions TLS automatically.

## Render

**One-click (Blueprint):** this repo includes [`render.yaml`](render.yaml). In
Render, choose **New + → Blueprint**, pick this repo, and Render reads the build/
start commands and env vars for you. Set `SPECULOS_SIGNATURE` when prompted
(optional), then apply.

**Manual setup instead:**

1. **New → Web Service**, connect this repo.
2. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
3. **Environment:** add `USE_MOCK_SIGNER=true` and, optionally, `SPECULOS_SIGNATURE`.
   Render sets `PORT` automatically.
4. Create the service and wait for the first deploy.

### Custom domain (Render)
- Service → **Settings → Custom Domains → Add Custom Domain** → `app.yourdomain.com`.
- Add the **CNAME** Render shows at your DNS provider (for an apex domain, follow
  Render's A-record / ANAME instructions).
- Render issues a TLS certificate once DNS resolves.

## Other Node hosts

Anything that can run a Node process works (Fly.io, a VPS, etc.): run
`npm install && npm run build`, then `npm start`, and route the host's `PORT` to
the process. Serve over HTTPS at the edge.

## Sanity check after deploy

- Open the site → the dashboard loads.
- Run a **normal transfer** → `ALLOW`, signature shown (captured-real if
  configured, otherwise simulated).
- Launch the **attack** → `BLOCK`, no signature, “signer never called”.
