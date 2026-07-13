import { createHash } from "node:crypto";
import path from "node:path";
import { readJson } from "./io.js";
import { isExplicitMemoryRequest } from "./memory-intent.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertRawRecordPath } from "./record-paths.js";
import { assertRawEvent } from "./schema-validation.js";
import type { RawEvent, Role } from "./types.js";
import { listJsonFiles } from "./vault.js";

const HOOK_AGENTS = new Set(["claude-code", "codex"]);
const OWNERSHIP_WINDOW_MS = 5 * 60 * 1000;

export async function findRecentEquivalentHookEvent(root: string, input: { projectId: string; role: Role; content: string; now?: number }): Promise<RawEvent | undefined> {
  const normalized = normalize(input.content);
  if (normalized.length < 8) return undefined;
  const events = await recentHookEvents(root, input.projectId, input.now ?? Date.now());
  return events.find(event => event.role === input.role && isExplicitMemoryRequest(event.content) && equivalent(normalized, normalize(event.content)));
}

export async function assertDecisionEvidenceNotHookOwned(root: string, projectId: string, evidenceRefs: string[], now = Date.now()): Promise<void> {
  const refs = new Set(evidenceRefs);
  const owned = (await recentHookEvents(root, projectId, now)).find(event => refs.has(event.event_id));
  if (owned) throw new Error(`Recent lifecycle hook evidence ${owned.event_id} is already owned by automatic processing; refusing duplicate decision-add`);
}

async function recentHookEvents(root: string, projectId: string, now: number): Promise<RawEvent[]> {
  const project = assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  const events = (await Promise.all((await listJsonFiles(path.join(p.raw, project), p.root)).map(async file => {
    try {
      const value = await readJson<unknown>(file);
      assertRawEvent(value);
      assertRawRecordPath(p, file, value);
      if (createHash("sha256").update(value.content).digest("hex") !== value.content_hash) return undefined;
      const age = now - Date.parse(value.timestamp);
      if (!HOOK_AGENTS.has(value.source_agent) || !Number.isFinite(age) || age < 0 || age > OWNERSHIP_WINDOW_MS) return undefined;
      return value;
    } catch { return undefined; }
  }))).filter((event): event is RawEvent => Boolean(event));
  return events.sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.seq_id - left.seq_id);
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function equivalent(shorter: string, longer: string): boolean {
  return shorter === longer || shorter.includes(longer) || longer.includes(shorter);
}
