# Privacy

Continuity stores visible conversation content in local files under `~/.continuity/vault` by default.

Local-first does not mean content always stays on the machine. When an agent recalls a local memory, the returned evidence may be sent to the cloud model currently serving that agent. This MVP does not use embeddings or an embedding API.

Secret-like content is captured as secret raw data when host hooks provide it, but is excluded from processed memory and ordinary recall. This is a safety baseline, not a complete secret scanner. Do not use the experimental build with data that requires audited compliance controls.

Uninstall preserves the vault. A future `purge` command will require separate confirmation; it is not implemented in the local slice.
