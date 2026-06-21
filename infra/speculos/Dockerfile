# Speculos service for Railway — runs the Ledger SOLANA app and serves the
# Speculos REST API + web UI on port 5000 so you can approve from a browser.
#
# You must provide the Solana app binary yourself at infra/speculos/solana.elf
# (it is git-ignored — never committed). See docs/railway.md.
FROM ghcr.io/ledgerhq/speculos:latest
COPY solana.elf /speculos/apps/app.elf
CMD ["--model","nanosp","--display","headless","--api-port","5000","/speculos/apps/app.elf"]
