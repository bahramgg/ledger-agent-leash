# Ledger app binaries (`.elf`)

Speculos emulates a Ledger device by running a real **app binary** (an ARM `.elf`).
This project's signer talks to the **Solana** app, so to run against a real
emulated device you need a Solana app ELF here, e.g. `apps/app.elf`.

ELF files are **not committed** (see `.gitignore`) — they are build artifacts and
can be large. Put your own here.

## Where to get a Solana app ELF

The Solana app is open source but Ledger does not publish ready-to-download ELFs,
so you build one with Ledger's app builder (Docker):

```bash
git clone https://github.com/LedgerHQ/app-solana
cd app-solana
docker pull ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools:latest
docker run --rm -ti -v "$(realpath .):/app" \
  ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools:latest \
  bash -c "BOLOS_SDK=\$NANOS_SDK make"   # or NANOX_SDK / NANOSP_SDK / STAX_SDK / FLEX_SDK
```

The build drops the binary at `bin/app.elf`. Copy it here:

```bash
cp app-solana/bin/app.elf <this-repo>/apps/app.elf
```

Match the SDK to the model you pass to Speculos (`SPECULOS_MODEL`, default `nanosp`).

See `docs/speculos.md` for the full run-through.
