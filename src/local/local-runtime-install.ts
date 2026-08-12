import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { atomicJson, assertReadableInside, assertWritableInside, ensureDir } from "../io.js";
import type { LocalCandidateAcquisitionReceipt } from "./local-candidate-acquisition.js";
import { modelCandidateIdentity, validateLocalModelCandidateManifest, type LocalModelCandidateManifest } from "./local-model-manifest.js";
import { writeRuntimeContentManifest } from "./local-runtime-content.js";
import {
  runtimeArtifactSpecs,
  runtimeCandidateIdentity,
  validateLocalRuntimeCandidateManifest,
  type LocalRuntimeCandidateManifest,
  type LocalRuntimePackage
} from "./local-runtime-manifest.js";
import { assertSafeId, assertSafeRelativePosixPath, vaultPaths } from "../paths.js";

const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_ARCHIVE_FILE_BYTES = 192 * 1024 * 1024;
const MAX_RUNTIME_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const LIFECYCLE_KEYS = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare"] as const;
const ROOT_RUNTIME_BRIDGES = new Map([["onnxruntime-common", "1.24.3"]]);

interface PackageJson {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  scripts: Record<string, string>;
  os?: string[];
  cpu?: string[];
}

interface InspectedPackage {
  manifest: LocalRuntimePackage;
  archive: string;
  archive_sha256: string;
  root_prefix: string;
  package_json: PackageJson;
  entry_count: number;
  unpacked_bytes: number;
}

export interface LocalRuntimeInstallManifest {
  schema_version: 1;
  status: "installed_candidate_validated";
  profile_id: string;
  platform: "darwin";
  arch: "arm64";
  node: string;
  runtime_identity: string;
  model_identity: string;
  input_policy_id: "multilingual-e5-query-passage-v1";
  dimension: number;
  runtime_entry: string;
  model_path: string;
  package_count: number;
  package_entry_count: number;
  runtime_unpacked_bytes: number;
  model_bytes: number;
  acquisition_receipt_sha256: string;
  content_manifest: "content-manifest.json";
  content_manifest_sha256: string;
  content_tree_sha256: string;
  content_file_count: number;
  content_directory_count: number;
  content_bytes: number;
  lifecycle_scripts_executed: false;
  package_manager_executed: false;
  installed_at: string;
}

export async function installLocalCandidate(
  root: string,
  input: { transactionId: string; runtimeManifest: unknown; modelManifest: unknown; now?: Date }
): Promise<{ root: string; manifest: LocalRuntimeInstallManifest; manifest_sha256: string }> {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("embedding.platform_unsupported");
  const transactionId = assertSafeId(input.transactionId, "Local artifact transaction id");
  const runtime = validateLocalRuntimeCandidateManifest(input.runtimeManifest);
  const model = validateLocalModelCandidateManifest(input.modelManifest);
  if (runtime.node !== process.version) throw new Error("embedding.runtime_node_mismatch");

  const p = vaultPaths(root);
  const source = path.join(p.modelCache, "staging", transactionId);
  const receiptFile = path.join(source, "acquisition-receipt.json");
  await assertReadableInside(root, receiptFile);
  const receiptBytes = await readFile(receiptFile);
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as LocalCandidateAcquisitionReceipt;
  assertAcquisitionReceipt(receipt, transactionId, runtime, model);
  const receiptByPath = new Map(receipt.artifacts.map(item => [item.relative_path, item]));

  const destination = path.join(p.modelCache, "installed", model.profile_id);
  const temporary = path.join(p.modelCache, "installed", `.${model.profile_id}.${randomUUID()}.tmp`);
  await assertWritableInside(root, destination);
  await assertWritableInside(root, temporary);
  if (await exists(destination)) throw new Error("embedding.runtime_already_installed");
  const filesystem = await statfs(p.modelCache);
  const freeBytes = filesystem.bavail * filesystem.bsize;
  if (!Number.isSafeInteger(freeBytes) || freeBytes < 768 * 1024 * 1024) throw new Error("embedding.runtime_disk_space_insufficient");

  await ensureDir(path.dirname(destination));
  await mkdir(temporary, { recursive: false, mode: 0o700 });
  try {
    const packages = await inspectRuntimePackages(source, runtime, receiptByPath);
    const placements = resolveProductionPlacements(packages, runtime.runtime);
    if (placements.size !== packages.length) throw new Error("embedding.runtime_dependency_graph_invalid");
    let runtimeBytes = 0;
    let entryCount = 0;
    const extractionOrder = [...packages].sort((left, right) => {
      const leftPath = placements.get(identity(left.package_json))!;
      const rightPath = placements.get(identity(right.package_json))!;
      return leftPath.split("/").length - rightPath.split("/").length || Buffer.compare(Buffer.from(leftPath), Buffer.from(rightPath));
    });
    for (const item of extractionOrder) {
      const relative = placements.get(identity(item.package_json));
      if (!relative) throw new Error("embedding.runtime_dependency_graph_invalid");
      const observed = await extractPackage(item, path.join(temporary, relative));
      runtimeBytes += observed.bytes;
      entryCount += observed.entries;
      if (runtimeBytes > MAX_RUNTIME_UNPACKED_BYTES) throw new Error("embedding.runtime_unpacked_limit");
    }

    const modelRoot = path.join(temporary, "model");
    let modelBytes = 0;
    for (const file of model.files) {
      const relative = safeRelativePath(file.relative_path);
      const receiptItem = receiptByPath.get(`model/${relative}`);
      if (!receiptItem) throw new Error("embedding.acquisition_receipt_invalid");
      modelBytes += await copyVerifiedFile(path.join(source, "model", relative), path.join(modelRoot, relative), receiptItem.sha256, file.max_bytes);
    }

    const runtimeEntry = "node_modules/@huggingface/transformers/src/transformers.js";
    await assertRegularFile(path.join(temporary, runtimeEntry));
    await assertRegularFile(path.join(modelRoot, "onnx/model_quantized.onnx"));
    const content = await writeRuntimeContentManifest(temporary);
    const manifest: LocalRuntimeInstallManifest = {
      schema_version: 1,
      status: "installed_candidate_validated",
      profile_id: model.profile_id,
      platform: "darwin",
      arch: "arm64",
      node: process.version,
      runtime_identity: runtimeCandidateIdentity(runtime),
      model_identity: modelCandidateIdentity(model),
      input_policy_id: "multilingual-e5-query-passage-v1",
      dimension: model.dimension,
      runtime_entry: runtimeEntry,
      model_path: "model",
      package_count: packages.length,
      package_entry_count: entryCount,
      runtime_unpacked_bytes: runtimeBytes,
      model_bytes: modelBytes,
      acquisition_receipt_sha256: sha256(receiptBytes),
      content_manifest: "content-manifest.json",
      content_manifest_sha256: content.sha256,
      content_tree_sha256: content.manifest.tree_sha256,
      content_file_count: content.manifest.file_count,
      content_directory_count: content.manifest.directory_count,
      content_bytes: content.manifest.content_bytes,
      lifecycle_scripts_executed: false,
      package_manager_executed: false,
      installed_at: (input.now ?? new Date()).toISOString()
    };
    const manifestFile = path.join(temporary, "install-manifest.json");
    await atomicJson(manifestFile, manifest);
    await chmod(manifestFile, 0o600);
    const manifestBytes = await readFile(manifestFile);
    await rename(temporary, destination);
    return { root: destination, manifest, manifest_sha256: sha256(manifestBytes) };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function inspectRuntimePackages(
  source: string,
  runtime: LocalRuntimeCandidateManifest,
  receipts: Map<string, LocalCandidateAcquisitionReceipt["artifacts"][number]>
): Promise<InspectedPackage[]> {
  const specs = runtimeArtifactSpecs(runtime);
  const result: InspectedPackage[] = [];
  for (let index = 0; index < runtime.packages.length; index += 1) {
    const item = runtime.packages[index]!;
    const spec = specs[index]!;
    const receipt = receipts.get(spec.relative_path);
    if (!receipt) throw new Error("embedding.acquisition_receipt_invalid");
    const archive = path.join(source, safeRelativePath(spec.relative_path));
    const inspected = await inspectPackageArchive(archive, item);
    if (inspected.archive_sha256 !== receipt.sha256) throw new Error("embedding.artifact_postwrite_mismatch");
    result.push(inspected);
  }
  return result;
}

async function inspectPackageArchive(archive: string, manifest: LocalRuntimePackage): Promise<InspectedPackage> {
  const roots = new Set<string>();
  const paths = new Set<string>();
  const packageJson: Buffer[] = [];
  let packageJsonBytes = 0;
  let packageJsonPath = "";
  let entries = 0;
  let bytes = 0;
  const archiveSha = createHash("sha256");
  await walkTarGzip(archive, archiveSha, header => {
    entries += 1;
    if (entries > MAX_ARCHIVE_ENTRIES) throw new Error("embedding.runtime_archive_entry_limit");
    const safe = safeTarPath(header.name);
    if (paths.has(safe)) throw new Error("embedding.runtime_archive_duplicate_path");
    paths.add(safe);
    const [root, ...rest] = safe.split("/");
    roots.add(root!);
    if (header.type === "file") {
      if (header.size > MAX_ARCHIVE_FILE_BYTES) throw new Error("embedding.runtime_archive_file_limit");
      bytes += header.size;
      if (bytes > MAX_RUNTIME_UNPACKED_BYTES) throw new Error("embedding.runtime_unpacked_limit");
      if (rest.join("/") === "package.json") {
        if (packageJsonPath || header.size > MAX_PACKAGE_JSON_BYTES) throw new Error("embedding.runtime_package_json_invalid");
        packageJsonPath = safe;
        return {
          data(chunk: Buffer) { packageJsonBytes += chunk.length; packageJson.push(Buffer.from(chunk)); },
          end() { if (packageJsonBytes !== header.size) throw new Error("embedding.runtime_package_json_invalid"); }
        };
      }
    }
    return undefined;
  });
  if (roots.size !== 1 || !packageJsonPath) throw new Error("embedding.runtime_archive_root_invalid");
  const parsed = parsePackageJson(Buffer.concat(packageJson));
  if (parsed.name !== manifest.name || parsed.version !== manifest.version) throw new Error("embedding.runtime_package_identity_mismatch");
  assertPlatform(parsed);
  const observedLifecycle = lifecycleScripts(parsed.scripts);
  if (!sameStringRecord(observedLifecycle, manifest.lifecycle_scripts)) throw new Error(`embedding.runtime_lifecycle_manifest_mismatch:${manifest.name}`);
  return {
    manifest,
    archive,
    archive_sha256: archiveSha.digest("hex"),
    root_prefix: packageJsonPath.split("/")[0]!,
    package_json: parsed,
    entry_count: entries,
    unpacked_bytes: bytes
  };
}

function resolveProductionPlacements(packages: InspectedPackage[], rootIdentity: string): Map<string, string> {
  const byIdentity = new Map(packages.map(item => [identity(item.package_json), item]));
  const byName = new Map<string, InspectedPackage[]>();
  for (const item of packages) byName.set(item.package_json.name, [...(byName.get(item.package_json.name) ?? []), item]);
  const root = byIdentity.get(rootIdentity);
  if (!root) throw new Error("embedding.runtime_dependency_graph_invalid");
  const reachable = new Set<string>();
  const edges = new Map<string, Map<string, InspectedPackage>>();
  const visit = (item: InspectedPackage): void => {
    const itemId = identity(item.package_json);
    if (reachable.has(itemId)) return;
    reachable.add(itemId);
    const dependencies = new Map<string, InspectedPackage>();
    for (const [name, range] of Object.entries(item.package_json.dependencies)) {
      const selected = selectDependency(byName.get(name) ?? [], range);
      if (!selected) throw new Error(`embedding.runtime_dependency_missing:${name}`);
      dependencies.set(name, selected);
      visit(selected);
    }
    for (const [name, range] of Object.entries(item.package_json.optionalDependencies)) {
      const selected = selectDependency(byName.get(name) ?? [], range);
      if (!selected || !platformAllowed(selected.package_json)) continue;
      dependencies.set(name, selected);
      visit(selected);
    }
    edges.set(itemId, dependencies);
  };
  visit(root);
  if (reachable.size !== packages.length) throw new Error("embedding.runtime_dependency_graph_has_extras");

  const placements = new Map<string, string>();
  placements.set(rootIdentity, packagePath(root.package_json.name));
  for (const item of packages) {
    const itemId = identity(item.package_json);
    if (itemId === rootIdentity) continue;
    const versions = byName.get(item.package_json.name)!;
    if (versions.length === 1 || ROOT_RUNTIME_BRIDGES.get(item.package_json.name) === item.package_json.version) placements.set(itemId, packagePath(item.package_json.name));
  }
  for (const [parentId, dependencies] of edges) {
    const parentPlacement = placements.get(parentId);
    for (const selected of dependencies.values()) {
      const selectedId = identity(selected.package_json);
      if ((byName.get(selected.package_json.name)?.length ?? 0) === 1) continue;
      if (placements.has(selectedId)) continue;
      if (!parentPlacement) throw new Error("embedding.runtime_dependency_graph_invalid");
      placements.set(selectedId, path.posix.join(parentPlacement, "node_modules", selected.package_json.name));
    }
  }
  return placements;
}

async function extractPackage(item: InspectedPackage, destination: string): Promise<{ entries: number; bytes: number }> {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await mkdir(destination, { recursive: false, mode: 0o700 });
  let entries = 0;
  let rootEntries = 0;
  let bytes = 0;
  await walkTarGzip(item.archive, undefined, async header => {
    const safe = safeTarPath(header.name);
    const prefix = `${item.root_prefix}/`;
    if (safe === item.root_prefix) {
      if (header.type !== "directory") throw new Error("embedding.runtime_archive_root_invalid");
      rootEntries += 1;
      return undefined;
    }
    if (!safe.startsWith(prefix)) throw new Error("embedding.runtime_archive_root_invalid");
    const relative = safeRelativePath(safe.slice(prefix.length));
    const target = childPath(destination, relative);
    entries += 1;
    if (header.type === "directory") {
      await mkdir(target, { recursive: true, mode: 0o700 });
      return undefined;
    }
    bytes += header.size;
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const handle = await open(target, "wx", 0o600);
    let written = 0;
    return {
      async data(chunk: Buffer) {
        const result = await handle.write(chunk);
        if (result.bytesWritten !== chunk.length) throw new Error("embedding.runtime_archive_short_write");
        written += chunk.length;
      },
      async end() {
        try {
          if (written !== header.size) throw new Error("embedding.runtime_archive_short_write");
          await handle.sync();
        } finally { await handle.close(); }
      }
    };
  });
  if (entries + rootEntries !== item.entry_count || bytes !== item.unpacked_bytes) throw new Error(`embedding.runtime_archive_changed:${item.manifest.name}`);
  return { entries, bytes };
}

interface TarHeader { name: string; size: number; type: "file" | "directory"; }
interface TarSink { data?(chunk: Buffer): void | Promise<void>; end?(): void | Promise<void>; }

async function walkTarGzip(
  file: string,
  compressedHash: ReturnType<typeof createHash> | undefined,
  onEntry: (header: TarHeader) => TarSink | undefined | Promise<TarSink | undefined>
): Promise<void> {
  const source = createReadStream(file);
  if (compressedHash) source.on("data", chunk => compressedHash.update(chunk));
  const stream = source.pipe(createGunzip());
  let buffer = Buffer.alloc(0);
  let current: { header: TarHeader; remaining: number; padding: number; sink?: TarSink } | undefined;
  let zeroBlocks = 0;
  let ended = false;
  for await (const raw of stream) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    while (true) {
      if (!current) {
        if (buffer.length < 512) break;
        const block = buffer.subarray(0, 512);
        buffer = buffer.subarray(512);
        if (block.every(byte => byte === 0)) { zeroBlocks += 1; if (zeroBlocks >= 2) ended = true; continue; }
        if (ended || zeroBlocks) throw new Error("embedding.runtime_archive_trailing_data");
        const header = parseTarHeader(block);
        current = { header, remaining: header.size, padding: (512 - header.size % 512) % 512, sink: await onEntry(header) };
      }
      if (current.remaining > 0) {
        if (!buffer.length) break;
        const length = Math.min(current.remaining, buffer.length);
        const data = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        current.remaining -= length;
        if (current.sink?.data) await current.sink.data(data);
        if (current.remaining > 0) continue;
      }
      if (buffer.length < current.padding) break;
      if (current.padding && !buffer.subarray(0, current.padding).every(byte => byte === 0)) throw new Error("embedding.runtime_archive_padding_invalid");
      buffer = buffer.subarray(current.padding);
      if (current.sink?.end) await current.sink.end();
      current = undefined;
    }
  }
  if (current || !ended || buffer.some(byte => byte !== 0)) throw new Error("embedding.runtime_archive_truncated");
}

function parseTarHeader(block: Buffer): TarHeader {
  const expected = parseTarOctal(block.subarray(148, 156));
  let observed = 0;
  for (let index = 0; index < block.length; index += 1) observed += index >= 148 && index < 156 ? 32 : block[index]!;
  if (expected !== observed) throw new Error("embedding.runtime_archive_checksum_invalid");
  const name = tarString(block.subarray(0, 100));
  const prefix = tarString(block.subarray(345, 500));
  const combined = prefix ? `${prefix}/${name}` : name;
  const type = block[156];
  const size = parseTarOctal(block.subarray(124, 136));
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("embedding.runtime_archive_size_invalid");
  if (type === 53) {
    if (size !== 0) throw new Error("embedding.runtime_archive_directory_invalid");
    return { name: combined.replace(/\/$/, ""), size, type: "directory" };
  }
  if (type !== 0 && type !== 48) throw new Error("embedding.runtime_archive_type_forbidden");
  return { name: combined, size, type: "file" };
}

function parseTarOctal(field: Buffer): number {
  if (field[0] && (field[0] & 0x80) !== 0) throw new Error("embedding.runtime_archive_number_invalid");
  const text = tarString(field).trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error("embedding.runtime_archive_number_invalid");
  return Number.parseInt(text, 8);
}

function tarString(field: Buffer): string {
  const end = field.indexOf(0);
  const value = field.subarray(0, end === -1 ? field.length : end).toString("utf8");
  if (value.includes("�")) throw new Error("embedding.runtime_archive_encoding_invalid");
  return value;
}

function parsePackageJson(bytes: Buffer): PackageJson {
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding.runtime_package_json_invalid");
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.version !== "string") throw new Error("embedding.runtime_package_json_invalid");
  return {
    name: item.name,
    version: item.version,
    dependencies: stringRecord(item.dependencies),
    optionalDependencies: stringRecord(item.optionalDependencies),
    scripts: stringRecord(item.scripts),
    ...(Array.isArray(item.os) && item.os.every(value => typeof value === "string") ? { os: item.os } : {}),
    ...(Array.isArray(item.cpu) && item.cpu.every(value => typeof value === "string") ? { cpu: item.cpu } : {})
  };
}

function selectDependency(candidates: InspectedPackage[], range: string): InspectedPackage | undefined {
  const selected = candidates.filter(item => satisfies(item.package_json.version, range));
  if (selected.length > 1) throw new Error("embedding.runtime_dependency_ambiguous");
  return selected[0];
}

function satisfies(version: string, range: string): boolean {
  if (range === version) return true;
  const parsed = semver(version);
  const prefix = range[0];
  if (prefix === "^" || prefix === "~") {
    const base = semver(range.slice(1));
    if (compareSemver(parsed, base) < 0) return false;
    if (prefix === "~") return parsed.major === base.major && parsed.minor === base.minor;
    if (base.major > 0) return parsed.major === base.major;
    if (base.minor > 0) return parsed.major === 0 && parsed.minor === base.minor;
    return parsed.major === 0 && parsed.minor === 0 && parsed.patch === base.patch;
  }
  if (range.startsWith(">=")) return compareSemver(parsed, semver(range.slice(2))) >= 0;
  return false;
}

interface Semver { major: number; minor: number; patch: number; prerelease: string | null; }
function semver(value: string): Semver {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) throw new Error("embedding.runtime_dependency_range_invalid");
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}
function compareSemver(left: Semver, right: Semver): number {
  for (const key of ["major", "minor", "patch"] as const) if (left[key] !== right[key]) return left[key] - right[key];
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

async function copyVerifiedFile(source: string, target: string, expectedSha256: string, maxBytes: number): Promise<number> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const handle = await open(target, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const raw of createReadStream(source)) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error("embedding.model_file_limit");
      hash.update(chunk);
      const result = await handle.write(chunk);
      if (result.bytesWritten !== chunk.length) throw new Error("embedding.model_short_write");
    }
    if (hash.digest("hex") !== expectedSha256) throw new Error("embedding.artifact_postwrite_mismatch");
    await handle.sync();
  } finally { await handle.close(); }
  return bytes;
}

function assertAcquisitionReceipt(
  receipt: LocalCandidateAcquisitionReceipt,
  transactionId: string,
  runtime: LocalRuntimeCandidateManifest,
  model: LocalModelCandidateManifest
): void {
  if (!receipt || receipt.schema_version !== 1) throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.status !== "artifacts_acquired_not_installed") throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.transaction_id !== transactionId) throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.platform !== "darwin" || receipt.arch !== "arm64") throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.node !== process.version) throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.runtime_manifest_sha256 !== runtimeCandidateIdentity(runtime)) throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.model_manifest_sha256 !== modelCandidateIdentity(model)) throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.lifecycle_scripts_executed !== false) throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.package_manager_executed !== false) throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.project_content_sent !== false) throw new Error("embedding.acquisition_receipt_invalid");
  if (receipt.artifacts.length !== 55) throw new Error("embedding.acquisition_receipt_invalid");
  const expected = [...runtimeArtifactSpecs(runtime).map(item => item.relative_path), ...model.files.map(item => `model/${item.relative_path}`)];
  if (new Set(receipt.artifacts.map(item => item.relative_path)).size !== expected.length) throw new Error("embedding.acquisition_receipt_invalid");
  receipt.artifacts.forEach((item, index) => {
    if (item.relative_path !== expected[index]) throw new Error("embedding.acquisition_receipt_invalid");
    if (item.integrity_verified !== true) throw new Error("embedding.acquisition_receipt_invalid");
    if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("embedding.acquisition_receipt_invalid");
    if (!Number.isInteger(item.bytes) || item.bytes < 1) throw new Error("embedding.acquisition_receipt_invalid");
  });
}

function lifecycleScripts(scripts: Record<string, string>): Record<string, string> {
  return Object.fromEntries(LIFECYCLE_KEYS.filter(key => Object.hasOwn(scripts, key)).map(key => [key, scripts[key]!]));
}
function stringRecord(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("embedding.runtime_package_json_invalid");
  }
  if (Object.entries(value).some(([key, item]) => !key || typeof item !== "string")) {
    throw new Error("embedding.runtime_package_json_invalid");
  }
  return value as Record<string, string>;
}
function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}
function identity(pkg: Pick<PackageJson, "name" | "version">): string { return `${pkg.name}@${pkg.version}`; }
function packagePath(name: string): string { return path.posix.join("node_modules", name); }
function platformAllowed(pkg: PackageJson): boolean { return (!pkg.os || pkg.os.includes(process.platform)) && (!pkg.cpu || pkg.cpu.includes(process.arch)); }
function assertPlatform(pkg: PackageJson): void { if (!platformAllowed(pkg)) throw new Error("embedding.runtime_package_platform_mismatch"); }
function safeTarPath(value: string): string {
  if (!value || Buffer.byteLength(value) > 1024) throw new Error("embedding.runtime_archive_path_invalid");
  if (value.includes("\\") || value.includes("\0")) throw new Error("embedding.runtime_archive_path_invalid");
  if (/^[\/]/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("embedding.runtime_archive_path_invalid");
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../")) {
    throw new Error("embedding.runtime_archive_path_invalid");
  }
  if (value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("embedding.runtime_archive_path_invalid");
  }
  return value;
}
function safeRelativePath(value: string): string { return assertSafeRelativePosixPath(value, "embedding.runtime_path_invalid"); }
function childPath(root: string, relative: string): string {
  const target = path.resolve(root, ...relative.split("/"));
  const relation = path.relative(path.resolve(root), target);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("embedding.runtime_path_invalid");
  return target;
}
async function assertRegularFile(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("embedding.runtime_install_invalid");
}
async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
