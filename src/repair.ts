import { rename } from "node:fs/promises";
import path from "node:path";
import { assertReadableInside, assertWritableInside, ensureDir, readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import { inspectVaultRecord, listVaultRecordCandidates } from "./record-inspection.js";
import { assertVaultConfig } from "./schema-validation.js";

export async function quarantineInvalidFiles(root: string): Promise<{ quarantined: string[]; skipped: string[] }> {
  const p = vaultPaths(root);
  const quarantined: string[] = [];
  const skipped: string[] = [];
  try {
    await assertReadableInside(p.root, p.config);
    assertVaultConfig(await readJson<unknown>(p.config));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await quarantineFile(p, "vault-config", p.config, quarantined, skipped);
    }
  }
  for (const candidate of await listVaultRecordCandidates(root)) {
    try {
      await inspectVaultRecord(root, candidate);
    } catch {
      if (candidate.repairable) await quarantineFile(p, candidate.kind, candidate.file, quarantined, skipped);
      else skipped.push(candidate.file);
    }
  }
  return { quarantined, skipped };
}

async function quarantineFile(
  p: ReturnType<typeof vaultPaths>,
  kind: string,
  file: string,
  quarantined: string[],
  skipped: string[]
): Promise<void> {
  const relative = path.relative(p.root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    skipped.push(file);
    return;
  }
  const destination = path.join(p.quarantine, kind.replaceAll("_", "-"), `${Date.now()}-${relative}`);
  await assertWritableInside(p.root, destination);
  await ensureDir(path.dirname(destination));
  await rename(file, destination);
  quarantined.push(path.relative(p.root, destination));
}
