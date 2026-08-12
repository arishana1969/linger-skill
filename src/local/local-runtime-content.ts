import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicJson, assertReadableInside } from "../io.js";
import { assertSafeRelativePosixPath } from "../paths.js";

const CONTENT_MANIFEST = "content-manifest.json";
const EXCLUDED_ROOT_FILES = new Set([CONTENT_MANIFEST, "install-manifest.json"]);
const MAX_CONTENT_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_ENTRIES = 10_000;

export type LocalRuntimeContentEntry =
  | { path: string; type: "directory" }
  | { path: string; type: "file"; bytes: number; sha256: string };

export interface LocalRuntimeContentManifest {
  schema_version: 1;
  entries: LocalRuntimeContentEntry[];
  file_count: number;
  directory_count: number;
  content_bytes: number;
  tree_sha256: string;
}

export async function writeRuntimeContentManifest(installRoot: string): Promise<{ manifest: LocalRuntimeContentManifest; sha256: string }> {
  const entries = await collectEntries(installRoot);
  const manifest = describe(entries);
  const file = path.join(installRoot, CONTENT_MANIFEST);
  await atomicJson(file, manifest);
  const bytes = await readFile(file);
  return { manifest, sha256: digest(bytes) };
}

export async function readRuntimeContentManifest(root: string, installRoot: string, expectedSha256: string): Promise<LocalRuntimeContentManifest> {
  if (!hash(expectedSha256)) throw new Error("embedding.runtime_content_invalid");
  const file = path.join(installRoot, CONTENT_MANIFEST);
  await assertReadableInside(root, file);
  const bytes = await readFile(file);
  if (bytes.length > MAX_CONTENT_MANIFEST_BYTES || digest(bytes) !== expectedSha256) throw new Error("embedding.runtime_content_invalid");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("embedding.runtime_content_invalid"); }
  return validate(value);
}

export async function verifyInstalledRuntimeContent(root: string, installRoot: string, expectedSha256: string): Promise<LocalRuntimeContentManifest> {
  const expected = await readRuntimeContentManifest(root, installRoot, expectedSha256);
  const observed = describe(await collectEntries(installRoot));
  if (JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error("embedding.runtime_content_mismatch");
  return expected;
}

async function collectEntries(root: string): Promise<LocalRuntimeContentEntry[]> {
  const result: LocalRuntimeContentEntry[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const child of children) {
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      if (!prefix && EXCLUDED_ROOT_FILES.has(child.name)) continue;
      const file = path.join(directory, child.name);
      const before = await lstat(file, { bigint: true });
      if (before.isSymbolicLink()) throw new Error("embedding.runtime_content_invalid");
      if (before.isDirectory()) {
        if ((Number(before.mode) & 0o777) !== 0o700) throw new Error("embedding.runtime_content_permissions_invalid");
        result.push({ path: safeRelativePath(relative), type: "directory" });
        await visit(file, relative);
      } else if (before.isFile()) {
        if ((Number(before.mode) & 0o777) !== 0o600 || before.nlink !== 1n || before.size < 0n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("embedding.runtime_content_permissions_invalid");
        const observed = await hashFile(file);
        const after = await lstat(file, { bigint: true });
        if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error("embedding.runtime_content_changed_during_validation");
        result.push({ path: safeRelativePath(relative), type: "file", bytes: observed.bytes, sha256: observed.sha256 });
      } else {
        throw new Error("embedding.runtime_content_invalid");
      }
      if (result.length > MAX_CONTENT_ENTRIES) throw new Error("embedding.runtime_content_entry_limit");
    }
  };
  await visit(root, "");
  result.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return result;
}

function describe(entries: LocalRuntimeContentEntry[]): LocalRuntimeContentManifest {
  const files = entries.filter((entry): entry is Extract<LocalRuntimeContentEntry, { type: "file" }> => entry.type === "file");
  const contentBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  if (!Number.isSafeInteger(contentBytes)) throw new Error("embedding.runtime_content_invalid");
  return {
    schema_version: 1,
    entries,
    file_count: files.length,
    directory_count: entries.length - files.length,
    content_bytes: contentBytes,
    tree_sha256: digest(Buffer.from(JSON.stringify(entries)))
  };
}

function validate(value: unknown): LocalRuntimeContentManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding.runtime_content_invalid");
  const item = value as Record<string, unknown>;
  if (!exactKeys(item, ["schema_version", "entries", "file_count", "directory_count", "content_bytes", "tree_sha256"]) || item.schema_version !== 1 || !Array.isArray(item.entries) || item.entries.length > MAX_CONTENT_ENTRIES || !hash(item.tree_sha256)) throw new Error("embedding.runtime_content_invalid");
  const entries: LocalRuntimeContentEntry[] = [];
  let previous = "";
  for (const raw of item.entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("embedding.runtime_content_invalid");
    const entry = raw as Record<string, unknown>;
    if (typeof entry.path !== "string" || safeRelativePath(entry.path) !== entry.path || (previous && Buffer.compare(Buffer.from(previous), Buffer.from(entry.path)) >= 0)) throw new Error("embedding.runtime_content_invalid");
    previous = entry.path;
    if (entry.type === "directory" && exactKeys(entry, ["path", "type"])) entries.push({ path: entry.path, type: "directory" });
    else if (entry.type === "file" && exactKeys(entry, ["path", "type", "bytes", "sha256"]) && Number.isSafeInteger(entry.bytes) && Number(entry.bytes) >= 0 && hash(entry.sha256)) entries.push({ path: entry.path, type: "file", bytes: Number(entry.bytes), sha256: entry.sha256 });
    else throw new Error("embedding.runtime_content_invalid");
  }
  const observed = describe(entries);
  if (item.file_count !== observed.file_count || item.directory_count !== observed.directory_count || item.content_bytes !== observed.content_bytes || item.tree_sha256 !== observed.tree_sha256) throw new Error("embedding.runtime_content_invalid");
  return observed;
}

async function hashFile(file: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const raw of createReadStream(file)) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.length;
    if (!Number.isSafeInteger(bytes)) throw new Error("embedding.runtime_content_invalid");
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

function safeRelativePath(value: string): string { return assertSafeRelativePosixPath(value, "embedding.runtime_content_invalid"); }

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const observed = Object.keys(value);
  return observed.length === keys.length && keys.every((key, index) => observed[index] === key);
}
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function digest(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
