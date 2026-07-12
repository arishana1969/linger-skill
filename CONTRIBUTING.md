# Contributing

This repository is still establishing its data and adapter contracts. Keep changes narrow, preserve file-native source records, and add a regression test for every behavior change.

Run before submitting changes:

```sh
pnpm install
node scripts/scan-tracked-secrets.mjs
pnpm build
node --test dist/*.test.js
```

Do not commit real vaults, transcripts, credentials, or generated evaluation data containing private content.
