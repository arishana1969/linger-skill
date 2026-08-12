import { open, readFile, realpath, lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { atomicJson, ensureDir } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertVaultConfig } from "./schema-validation.js";
import { initVault, type VaultConfig } from "./vault.js";

type SettingValue = boolean | number | string;
type SettingScope = "global" | "project" | "temporary";
type SettingSource = "builtin" | SettingScope | "policy";

interface SettingSpec {
  builtin: SettingValue;
  scopes: readonly SettingScope[];
  persistence?: "legacy";
  validate(value: unknown): value is SettingValue;
}

const boolean = (value: unknown): value is boolean => typeof value === "boolean";
const integer = (min: number, max: number) => (value: unknown): value is number => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const number = (min: number, max: number) => (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const oneOf = (...allowed: string[]) => (value: unknown): value is string => typeof value === "string" && allowed.includes(value);

const SPECS = {
  "capture.paused": { builtin: false, scopes: ["global"], persistence: "legacy", validate: boolean },
  "capture_health.operational_evidence": { builtin: "minimal", scopes: ["global"], validate: oneOf("minimal", "off") },
  "recall.max_snippets": { builtin: 8, scopes: ["global", "project", "temporary"], persistence: "legacy", validate: integer(1, 100) },
  "recall.max_characters": { builtin: 12000, scopes: ["global", "project", "temporary"], persistence: "legacy", validate: integer(1, 100000) },
  "recall.max_files": { builtin: 5000, scopes: ["global", "project", "temporary"], persistence: "legacy", validate: integer(1, 50000) },
  "recall.max_raw_fragment_characters": { builtin: 500, scopes: ["global", "project", "temporary"], persistence: "legacy", validate: integer(1, 5000) },
  "recall.timeout_ms": { builtin: 2000, scopes: ["global", "project", "temporary"], persistence: "legacy", validate: integer(0, 30000) },
  "staleness.warning_enabled": { builtin: true, scopes: ["global", "project", "temporary"], validate: boolean },
  "staleness.threshold_days": { builtin: 90, scopes: ["global", "project", "temporary"], validate: integer(1, 3650) },
  "embedding.desired_enabled": { builtin: false, scopes: ["project", "temporary"], validate: boolean },
  "embedding.profile_id": { builtin: "", scopes: ["project", "temporary"], validate: (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) },
  "embedding.semantic_weight": { builtin: 0.7, scopes: ["global", "project", "temporary"], validate: number(0, 1) }
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SPECS;

const LEGACY_KEYS: Partial<Record<SettingKey, keyof VaultConfig>> = {
  "capture.paused": "paused",
  "recall.max_snippets": "max_snippets",
  "recall.max_characters": "max_characters",
  "recall.max_files": "max_files",
  "recall.max_raw_fragment_characters": "max_raw_fragment_characters",
  "recall.timeout_ms": "search_timeout_ms"
};

const DEPRECATED_KEYS = new Set([
  "notifications.abnormal",
  "recall.sampling_enabled",
  "recall.project_only",
  "sensitive.exclusion"
]);

interface SettingsDocument {
  schema_version: 1;
  scope: "global" | "project";
  project_id?: string;
  revision: number;
  updated_at: string;
  values: Partial<Record<SettingKey, SettingValue>>;
}

export interface EffectiveSetting {
  value: SettingValue;
  source: SettingSource;
  source_path?: string;
  safety_override: boolean;
  requested_value?: SettingValue;
  requested_source?: SettingSource;
}

export interface EffectiveSettings {
  schema_version: 1;
  project_id?: string;
  global_revision: number;
  project_revision: number;
  values: Record<SettingKey, EffectiveSetting>;
}

export async function resolveSettings(
  root: string,
  options: { projectId?: string; temporary?: Record<string, unknown> } = {}
): Promise<EffectiveSettings> {
  const projectId = options.projectId === undefined ? undefined : assertSafeId(options.projectId, "project id");
  const values = Object.fromEntries(Object.entries(SPECS).map(([key, spec]) => [key, {
    value: spec.builtin,
    source: "builtin",
    safety_override: false
  }])) as Record<SettingKey, EffectiveSetting>;

  const legacyPath = vaultPaths(root).config;
  const legacy = await readOptionalJson(root, legacyPath);
  if (legacy !== undefined) {
    assertVaultConfig(legacy);
    for (const [key, field] of Object.entries(LEGACY_KEYS) as Array<[SettingKey, keyof VaultConfig]>) {
      merge(values, key, legacy[field] as SettingValue, "global", legacyPath);
    }
  }

  const globalPath = path.join(vaultPaths(root).root, "settings", "global.json");
  const global = await readDocument(root, globalPath, "global");
  if (global) for (const [key, value] of Object.entries(global.values)) merge(values, settingKey(key), value, "global", globalPath);

  let project: SettingsDocument | undefined;
  let projectPath: string | undefined;
  if (projectId) {
    projectPath = path.join(vaultPaths(root).root, "settings", "projects", `${projectId}.json`);
    project = await readDocument(root, projectPath, "project", projectId);
    if (project) for (const [key, value] of Object.entries(project.values)) merge(values, settingKey(key), value, "project", projectPath);
  }

  for (const [key, value] of Object.entries(options.temporary ?? {})) merge(values, settingKey(key), value, "temporary");
  return {
    schema_version: 1,
    ...(projectId ? { project_id: projectId } : {}),
    global_revision: global?.revision ?? 0,
    project_revision: project?.revision ?? 0,
    values
  };
}

export async function setSetting(root: string, input: {
  scope: "global" | "project";
  key: string;
  value: unknown;
  projectId?: string;
  ifRevision?: number;
}): Promise<EffectiveSettings> {
  const key = settingKey(input.key);
  const spec: SettingSpec = SPECS[key];
  if (!spec.scopes.includes(input.scope)) throw new Error(`${key} cannot be set at ${input.scope} scope`);
  if (!spec.validate(input.value)) throw new Error(`Invalid value for ${key}`);
  const projectId = input.scope === "project" ? assertSafeId(input.projectId ?? "", "project id") : undefined;
  await initVault(root);

  if (spec.persistence === "legacy" && input.scope === "global") {
    const field = LEGACY_KEYS[key];
    if (!field) throw new Error(`Missing legacy mapping for ${key}`);
    const p = vaultPaths(root);
    await withBoundedLock(path.join(p.root, "settings", "locks", "legacy.lock"), async () => {
      const config = await initVault(root);
      const next = { ...config, [field]: input.value };
      assertVaultConfig(next);
      await atomicJson(p.config, next);
    });
    return await resolveSettings(root, { projectId });
  }

  const file = input.scope === "global"
    ? path.join(vaultPaths(root).root, "settings", "global.json")
    : path.join(vaultPaths(root).root, "settings", "projects", `${projectId}.json`);
  const lock = path.join(vaultPaths(root).root, "settings", "locks", input.scope === "global" ? "global.lock" : `${projectId}.lock`);
  await withBoundedLock(lock, async () => {
    const current = await readDocument(root, file, input.scope, projectId) ?? {
      schema_version: 1 as const,
      scope: input.scope,
      ...(projectId ? { project_id: projectId } : {}),
      revision: 0,
      updated_at: new Date(0).toISOString(),
      values: {}
    };
    if (input.ifRevision !== undefined && input.ifRevision !== current.revision) throw new Error("config.stale_revision");
    await atomicJson(file, {
      ...current,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
      values: { ...current.values, [key]: input.value }
    });
  });
  return await resolveSettings(root, { projectId });
}

export function parseSettingValue(keyInput: string, raw: string): SettingValue {
  const key = settingKey(keyInput);
  const builtin = SPECS[key].builtin;
  const value: unknown = typeof builtin === "boolean" ? raw === "true" ? true : raw === "false" ? false : raw
    : typeof builtin === "number" ? Number(raw)
      : raw;
  if (!SPECS[key].validate(value)) throw new Error(`Invalid value for ${key}`);
  return value;
}

function merge(values: Record<SettingKey, EffectiveSetting>, key: SettingKey, value: unknown, source: SettingScope, sourcePath?: string): void {
  const spec: SettingSpec = SPECS[key];
  if (!spec.scopes.includes(source) && !(source === "global" && spec.persistence === "legacy")) throw new Error(`${key} is not allowed in ${source} settings`);
  if (!spec.validate(value)) throw new Error(`Invalid value for ${key}`);
  values[key] = { value, source, ...(sourcePath ? { source_path: sourcePath } : {}), safety_override: false };
}

function settingKey(value: string): SettingKey {
  if (!Object.hasOwn(SPECS, value)) throw new Error(`Unknown setting: ${value}`);
  return value as SettingKey;
}

async function readDocument(root: string, file: string, scope: "global" | "project", projectId?: string): Promise<SettingsDocument | undefined> {
  const value = await readOptionalJson(root, file);
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${scope} settings`);
  const item = value as Record<string, unknown>;
  const allowed = new Set(["schema_version", "scope", "revision", "updated_at", "values", ...(scope === "project" ? ["project_id"] : [])]);
  if (Object.keys(item).some(key => !allowed.has(key))) throw new Error(`Invalid ${scope} settings fields`);
  if (item.schema_version !== 1 || item.scope !== scope || !Number.isInteger(item.revision) || Number(item.revision) < 0) throw new Error(`Invalid ${scope} settings`);
  if (typeof item.updated_at !== "string" || !Number.isFinite(Date.parse(item.updated_at))) throw new Error(`Invalid ${scope} settings updated_at`);
  if (scope === "project" && item.project_id !== projectId) throw new Error("Invalid project settings identity");
  if (!item.values || typeof item.values !== "object" || Array.isArray(item.values)) throw new Error(`Invalid ${scope} settings values`);
  const values: Partial<Record<SettingKey, SettingValue>> = {};
  for (const [rawKey, rawValue] of Object.entries(item.values)) {
    if (DEPRECATED_KEYS.has(rawKey)) continue;
    const key = settingKey(rawKey);
    const spec: SettingSpec = SPECS[key];
    if (scope === "global" && spec.persistence === "legacy") throw new Error(`${key} must remain in legacy config`);
    if (!spec.scopes.includes(scope) || !spec.validate(rawValue)) throw new Error(`Invalid ${scope} setting ${key}`);
    values[key] = rawValue;
  }
  return { schema_version: 1, scope, ...(projectId ? { project_id: projectId } : {}), revision: Number(item.revision), updated_at: item.updated_at as string, values };
}

async function readOptionalJson(root: string, file: string): Promise<unknown | undefined> {
  const rootPath = path.resolve(root);
  let rootReal: string;
  try { rootReal = await realpath(rootPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  let info;
  try { info = await lstat(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Settings source must be a regular file");
  const fileReal = await realpath(file);
  const relative = path.relative(rootReal, fileReal);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Settings path escapes Vault");
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function withBoundedLock<T>(file: string, action: () => Promise<T>, timeoutMs = 500): Promise<T> {
  await ensureDir(path.dirname(file));
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try { handle = await open(file, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("config.write_conflict");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try { return await action(); }
  finally { await handle.close(); await unlink(file).catch(() => undefined); }
}
