import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertReadableInside, assertWritableInside, atomicJson, ensureDir, readJson } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertProjectRecord, assertQueueItem, assertVaultConfig } from "./schema-validation.js";
import { assertProjectRecordPath, assertQueueRecordPath } from "./record-paths.js";

export interface VaultConfig {
  schema_version: 1;
  paused: boolean;
  project_only_recall: boolean;
  sensitive_exclusion: boolean;
  max_snippets: number;
  max_characters: number;
  max_files: number;
  max_raw_fragment_characters: number;
  search_timeout_ms: number;
  created_at: string;
}

export interface ProjectRecord {
  schema_version: 1;
  project_id: string;
  display_name: string;
  root_path: string;
  identity_source: "git_remote_root" | "git_root" | "git_common_dir" | "absolute_path";
  locator_hash?: string;
  remote_hash?: string;
  identity_changed?: boolean;
  created_at: string;
  last_seen: string;
}

interface ProjectIdentity {
  project_id: string;
  display_name: string;
  root_path: string;
  identity_source: "git_common_dir" | "absolute_path";
  locator_hash: string;
  remote_hash?: string;
}

interface ProjectLocatorRecord {
  schema_version: 1;
  locator_hash: string;
  project_id: string;
  identity_source: ProjectIdentity["identity_source"];
  attached_at: string;
}

function defaultConfig(createdAt = new Date().toISOString()): VaultConfig {
  return {
    schema_version: 1,
    paused: false,
    project_only_recall: true,
    sensitive_exclusion: true,
    max_snippets: 8,
    max_characters: 12000,
    max_files: 5000,
    max_raw_fragment_characters: 500,
    search_timeout_ms: 2000,
    created_at: createdAt
  };
}

export async function initVault(root: string): Promise<VaultConfig> {
  const p = vaultPaths(root);
  await Promise.all([
    p.projects, p.raw, p.processed, p.enrichments, p.queue, p.tmp, p.registry, p.decisions, p.quarantine
  ].map(ensureDir));
  await assertWritableInside(p.root, p.config);
  try {
    const existing = await readJson<Partial<VaultConfig> & Record<string, unknown>>(p.config);
    if (existing.schema_version !== 1) throw new Error(`Unsupported vault config schema: ${String(existing.schema_version)}`);
    const next = {
      ...defaultConfig(typeof existing.created_at === "string" ? existing.created_at : undefined),
      ...existing,
      project_only_recall: true,
      sensitive_exclusion: true
    } as VaultConfig;
    assertVaultConfig(next);
    if (JSON.stringify(existing) !== JSON.stringify(next)) { await assertWritableInside(p.root, p.config); await atomicJson(p.config, next); }
    return next;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const config = defaultConfig();
  await assertWritableInside(p.root, p.config);
  await atomicJson(p.config, config);
  return config;
}

export async function setPaused(root: string, paused: boolean): Promise<VaultConfig> {
  const p = vaultPaths(root);
  const config = await initVault(root);
  const next = { ...config, paused };
  await assertWritableInside(p.root, p.config);
  await atomicJson(p.config, next);
  return next;
}

export async function projectId(cwd: string, root?: string): Promise<string> {
  const identity = await projectIdentity(cwd);
  if (!root) return identity.project_id;
  const mapped = await readProjectLocator(root, identity.locator_hash);
  if (!mapped) {
    return (await legacyProjectForRoot(root, identity.root_path))?.project_id ?? identity.project_id;
  }
  if (!await readProjectRecord(root, mapped.project_id)) throw new Error("project.identity_locator_invalid");
  return mapped.project_id;
}

export async function registerProject(root: string, cwd: string): Promise<ProjectRecord> {
  await initVault(root);
  const identity = await projectIdentity(cwd);
  const p = vaultPaths(root);
  const mapped = await readProjectLocator(root, identity.locator_hash);
  if (mapped && !await readProjectRecord(root, mapped.project_id)) throw new Error("project.identity_locator_invalid");
  const legacy = mapped ? undefined : await legacyProjectForRoot(root, identity.root_path);
  const project = mapped?.project_id ?? legacy?.project_id ?? identity.project_id;
  const file = path.join(p.projects, `${project}.json`);
  await assertWritableInside(p.root, file);
  const now = new Date().toISOString();
  let createdAt = now;
  let existing: ProjectRecord | undefined;
  try { const value = await readJson<unknown>(file); assertProjectRecord(value); assertProjectRecordPath(p, file, value); existing = value; createdAt = value.created_at; } catch { }
  const remoteChanged = Boolean(existing?.remote_hash && identity.remote_hash && existing.remote_hash !== identity.remote_hash);
  const record: ProjectRecord = {
    schema_version: 1,
    project_id: project,
    display_name: identity.display_name,
    root_path: identity.root_path,
    identity_source: identity.identity_source,
    locator_hash: identity.locator_hash,
    ...(existing?.remote_hash ? { remote_hash: existing.remote_hash } : identity.remote_hash ? { remote_hash: identity.remote_hash } : {}),
    ...(remoteChanged || existing?.identity_changed ? { identity_changed: true } : {}),
    created_at: createdAt,
    last_seen: now
  };
  await assertWritableInside(p.root, file);
  await atomicJson(file, record);
  if (!mapped) await writeProjectLocator(root, { schema_version: 1, locator_hash: identity.locator_hash, project_id: project, identity_source: identity.identity_source, attached_at: now });
  return record;
}

export async function readProjectRecord(root: string, projectIdInput: string): Promise<ProjectRecord | undefined> {
  const project = assertSafeId(projectIdInput, "project id");
  const p = vaultPaths(root);
  const file = path.join(p.projects, `${project}.json`);
  try {
    await assertReadableInside(p.root, file);
    const value = await readJson<unknown>(file);
    assertProjectRecord(value);
    assertProjectRecordPath(p, file, value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function attachProject(root: string, projectIdInput: string, cwd: string, confirmed: boolean): Promise<ProjectRecord> {
  if (!confirmed) throw new Error("project attach requires --yes");
  const project = assertSafeId(projectIdInput, "project id");
  const target = await readProjectRecord(root, project);
  if (!target) throw new Error("project.identity_target_missing");
  const identity = await projectIdentity(cwd);
  const mapped = await readProjectLocator(root, identity.locator_hash);
  if (mapped && mapped.project_id !== project) throw new Error("project.identity_locator_conflict");
  const provisional = mapped?.project_id ?? identity.project_id;
  if (provisional !== project && await projectHasState(root, provisional)) throw new Error("project.identity_split_requires_manual_migration");
  const now = new Date().toISOString();
  await writeProjectLocator(root, { schema_version: 1, locator_hash: identity.locator_hash, project_id: project, identity_source: identity.identity_source, attached_at: now });
  const next: ProjectRecord = {
    ...target,
    display_name: identity.display_name,
    root_path: identity.root_path,
    identity_source: identity.identity_source,
    locator_hash: identity.locator_hash,
    ...(identity.remote_hash ? { remote_hash: identity.remote_hash } : {}),
    identity_changed: false,
    last_seen: now
  };
  await atomicJson(path.join(vaultPaths(root).projects, `${project}.json`), next);
  return next;
}

export async function confirmProjectIdentity(root: string, projectIdInput: string, cwd: string, confirmed: boolean): Promise<ProjectRecord> {
  if (!confirmed) throw new Error("project identity confirmation requires --yes");
  const project = assertSafeId(projectIdInput, "project id");
  const current = await readProjectRecord(root, project);
  if (!current) throw new Error("project.identity_target_missing");
  const identity = await projectIdentity(cwd);
  const mapped = await readProjectLocator(root, identity.locator_hash);
  if (mapped?.project_id !== project) throw new Error("project.identity_locator_mismatch");
  const next: ProjectRecord = {
    ...current,
    display_name: identity.display_name,
    root_path: identity.root_path,
    identity_source: identity.identity_source,
    locator_hash: identity.locator_hash,
    ...(identity.remote_hash ? { remote_hash: identity.remote_hash } : {}),
    identity_changed: false,
    last_seen: new Date().toISOString()
  };
  await atomicJson(path.join(vaultPaths(root).projects, `${project}.json`), next);
  return next;
}

export async function projectLocatorErrors(root: string): Promise<string[]> {
  const p = vaultPaths(root);
  const directory = path.join(p.registry, "project-locators");
  const errors: string[] = [];
  for (const file of await listJsonFiles(directory, p.root)) {
    const locatorHash = path.basename(file, ".json");
    try {
      const record = await readJson<unknown>(file);
      assertProjectLocator(record, locatorHash);
      if (path.resolve(file) !== path.resolve(directory, `${record.locator_hash}.json`) || !await readProjectRecord(root, record.project_id)) throw new Error("project.identity_locator_invalid");
    } catch { errors.push(path.relative(p.root, file)); }
  }
  return errors.sort();
}

export async function listProjects(root: string): Promise<ProjectRecord[]> {
  const p = vaultPaths(root);
  return (await Promise.all((await listJsonFiles(p.projects, p.root)).map(async file => {
    try { const value = await readJson<unknown>(file); assertProjectRecord(value); assertProjectRecordPath(p, file, value); return value; } catch { return undefined; }
  }))).filter((record): record is ProjectRecord => Boolean(record)).sort((a, b) => b.last_seen.localeCompare(a.last_seen) || a.project_id.localeCompare(b.project_id));
}

async function legacyProjectForRoot(root: string, rootPath: string): Promise<ProjectRecord | undefined> {
  const expected = await realpath(path.resolve(rootPath)).catch(() => path.resolve(rootPath));
  const matches: ProjectRecord[] = [];
  for (const record of await listProjects(root)) {
    const candidate = await realpath(path.resolve(record.root_path)).catch(() => path.resolve(record.root_path));
    if (candidate === expected) matches.push(record);
  }
  if (matches.length > 1) throw new Error("project.identity_legacy_ambiguous");
  return matches[0];
}

async function projectIdentity(cwd: string): Promise<ProjectIdentity> {
  const requested = path.resolve(cwd);
  const resolved = await realpath(requested).catch(() => requested);
  const remote = await gitValue(resolved, ["config", "--get", "remote.origin.url"]);
  const gitRoot = await gitValue(resolved, ["rev-parse", "--show-toplevel"]);
  const commonDirRaw = await gitValue(resolved, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    ?? await gitValue(resolved, ["rev-parse", "--git-common-dir"]);
  const rootPath = gitRoot ?? resolved;
  const commonDir = commonDirRaw ? await realpath(path.resolve(resolved, commonDirRaw)).catch(() => path.resolve(resolved, commonDirRaw)) : undefined;
  const identitySource = commonDir && gitRoot ? "git_common_dir" as const : "absolute_path" as const;
  const material = commonDir && gitRoot ? `git-common-dir\0${commonDir}` : `absolute-path\0${rootPath}`;
  const locatorHash = createHash("sha256").update(material).digest("hex");
  return {
    project_id: `p_${locatorHash.slice(0, 32)}`,
    display_name: path.basename(rootPath) || rootPath,
    root_path: rootPath,
    identity_source: identitySource,
    locator_hash: locatorHash,
    ...(remote ? { remote_hash: createHash("sha256").update(remote).digest("hex") } : {})
  };
}

async function readProjectLocator(root: string, locatorHash: string): Promise<ProjectLocatorRecord | undefined> {
  const file = path.join(vaultPaths(root).registry, "project-locators", `${locatorHash}.json`);
  try {
    await assertReadableInside(root, file);
    const value = await readJson<unknown>(file);
    assertProjectLocator(value, locatorHash);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeProjectLocator(root: string, record: ProjectLocatorRecord): Promise<void> {
  const file = path.join(vaultPaths(root).registry, "project-locators", `${record.locator_hash}.json`);
  await assertWritableInside(root, file);
  await ensureDir(path.dirname(file));
  await atomicJson(file, record);
}

function assertProjectLocator(value: unknown, locatorHash: string): asserts value is ProjectLocatorRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("project.identity_locator_invalid");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 5 || item.schema_version !== 1 || item.locator_hash !== locatorHash || typeof item.project_id !== "string" || (item.identity_source !== "git_common_dir" && item.identity_source !== "absolute_path") || typeof item.attached_at !== "string" || !Number.isFinite(Date.parse(item.attached_at))) throw new Error("project.identity_locator_invalid");
  assertSafeId(item.project_id, "project id");
  if (!/^[a-f0-9]{64}$/.test(locatorHash)) throw new Error("project.identity_locator_invalid");
}

async function projectHasState(root: string, project: string): Promise<boolean> {
  const p = vaultPaths(root);
  for (const dir of [
    p.raw, p.processed, p.enrichments, p.queue, p.decisions, p.embeddings,
    path.join(p.registry, "memory-events"), path.join(p.registry, "term-graph"),
    path.join(p.registry, "recall-samples"), path.join(p.registry, "enrichment-batches")
  ]) {
    if ((await listJsonFiles(path.join(dir, project), p.root)).length) return true;
  }
  for (const file of [
    path.join(p.root, "settings", "projects", `${project}.json`),
    path.join(p.registry, "tags", `${project}.json`),
    path.join(p.registry, "processing-runs", `${project}.json`),
    path.join(p.registry, `${project}.sequence.json`)
  ]) {
    try { await stat(file); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return true; }
  }
  for (const file of await listJsonFiles(path.join(p.registry, "lifecycle-evidence", "v3"), p.root)) {
    if (path.relative(path.join(p.registry, "lifecycle-evidence", "v3"), file).split(path.sep).includes(project)) return true;
  }
  return false;
}

async function gitValue(cwd: string, args: string[]): Promise<string | undefined> {
  const { execFile } = await import("node:child_process");
  return await new Promise((resolve) => {
    execFile("git", args, { cwd }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined));
  });
}

export async function listJsonFiles(dir: string, boundaryRoot: string): Promise<string[]> {
  try {
    await assertReadableInside(boundaryRoot, dir);
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await listJsonFiles(target, boundaryRoot));
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
    }
    return files.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readVaultConfig(root: string): Promise<VaultConfig | undefined> {
  const file = vaultPaths(root).config;
  try {
    await assertReadableInside(root, file);
    const config = await readJson<unknown>(file);
    assertVaultConfig(config);
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function vaultStats(root: string, projectId?: string): Promise<Record<string, number | boolean | string>> {
  const p = vaultPaths(root);
  const config = await readVaultConfig(root);
  const project = projectId === undefined ? undefined : assertSafeId(projectId, "project id");
  const scoped = (dir: string): string => project ? path.join(dir, project) : dir;
  const [raw, processed, enrichments, queue, pendingCaptures] = await Promise.all([
    listJsonFiles(scoped(p.raw), p.root), listJsonFiles(scoped(p.processed), p.root), listJsonFiles(scoped(p.enrichments), p.root), listJsonFiles(scoped(p.queue), p.root), listJsonFiles(scoped(path.join(p.tmp, "pending")), p.root)
  ]);
  const queueCounts = { pending: 0, processing: 0, failed: 0, done: 0, invalid: 0 };
  for (const file of queue) {
    try { const item = await readJson<unknown>(file); assertQueueItem(item); assertQueueRecordPath(p, file, item); queueCounts[item.status] += 1; } catch { queueCounts.invalid += 1; }
  }
  let bytes = 0;
  for (const file of [...raw, ...processed, ...enrichments]) bytes += (await stat(file)).size;
  return { scope: project ? "project" : "vault", ...(project ? { project_id: project } : {}), initialized: Boolean(config), paused: config?.paused ?? false, raw_events: raw.length, processed_memories: processed.length, enriched_memories: enrichments.length, queue_items: queue.length, queue_pending: queueCounts.pending, queue_processing: queueCounts.processing, queue_failed: queueCounts.failed, queue_done: queueCounts.done, queue_invalid: queueCounts.invalid, pending_captures: pendingCaptures.length, bytes };
}
