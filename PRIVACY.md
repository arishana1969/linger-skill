# Privacy

Continuity stores visible conversation content in local files under `~/.continuity/vault` by default.

Local-first does not mean content always stays on the machine. When an agent recalls a local memory, the returned evidence may be sent to the cloud model currently serving that agent. This MVP does not use embeddings or an embedding API.

High-confidence secret-like values detected at the shared capture boundary are redacted before raw persistence, marked secret, excluded from processed memory, and excluded from ordinary recall. This applies to host hooks, manual CLI capture, and programmatic capture. Unknown secret formats may not be detected, and content explicitly marked secret can still remain in raw when no detector identifies the value, so the Vault must be protected like any other local transcript archive. This is a safety baseline, not a complete secret scanner or encryption system. Do not use the experimental build with data that requires audited compliance controls.

Uninstall preserves the vault. `purge` removes Continuity state only after both `--yes` and the exact confirmation phrase; it is intentionally separate from uninstall.
