import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parseManagedHookCommand } from "./hook-command.js";
import { runtimeFingerprint } from "./runtime-identity.js";
import { assertReadableInside } from "./io.js";
import { verifiedCodexLifecycleSession, type VerifiedLiveSession } from "./lifecycle-evidence.js";

export type CapabilityLevel = 0 | 1 | 2 | 3 | 4;
export type AdapterName = "claude-code" | "codex";
export interface AdapterCapability {
  adapter: AdapterName; detected: boolean; installed: boolean; level: CapabilityLevel;
  capabilities: { rules: boolean; file_access: boolean; lifecycle_hooks: boolean; async_processing: boolean; recovery: boolean };
  evidence: string[]; limitations: string[];
}

export async function capabilityReport(home: string): Promise<AdapterCapability[]> { return [await detectClaudeCode(home), await detectCodex(home)]; }

export async function detectClaudeCode(home: string): Promise<AdapterCapability> {
  const root = path.join(home, ".claude");
  const settings = path.join(root, "settings.json");
  const skill = path.join(root, "skills", "linger", "SKILL.md");
  const detected = await exists(root);
  const installed = await exists(skill);
  let hooks = false;
  try {
    const parsed = JSON.parse(await readFile(settings, "utf8")) as { hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>> };
    hooks = (await commonManagedRuntimeIdentities(parsed, home, "claude-code", ["SessionStart", "UserPromptSubmit", "Stop"])).length > 0;
  } catch { /* absent or invalid */ }
  const level: CapabilityLevel = hooks && installed ? 2 : installed ? 1 : 0;
  return result("claude-code", detected, installed, level, hooks, [detected ? root : "Claude Code directory not found", hooks ? `${settings} (managed hooks verified)` : "No verified Linger hooks detected"], ["Lifecycle capability does not by itself prove current-project capture health.", "Background processing remains session-local; no daemon is installed."]);
}

export async function detectCodex(home: string): Promise<AdapterCapability> {
  const root = path.join(home, ".codex");
  const config = path.join(root, "config.toml");
  const hooksFile = path.join(root, "hooks.json");
  const skill = await firstExisting([
    path.join(home, ".codex", "skills", "linger", "SKILL.md"),
    path.join(home, ".agents", "skills", "linger", "SKILL.md")
  ]);
  const detected = await exists(root);
  const installed = Boolean(skill);
  let hooks = false;
  let lingerHooks = false;
  let runtimeIdentities: string[] = [];
  let hookEvidence: string | undefined;
  try { hooks = /(^|\n)\s*\[hooks(?:\.|\])/m.test(await readFile(config, "utf8")); if (hooks) hookEvidence = config; } catch { /* absent */ }
  if (await exists(hooksFile)) {
    hooks = true;
    hookEvidence = hooksFile;
    try {
      const document = JSON.parse(await readFile(hooksFile, "utf8")) as { hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>> };
      runtimeIdentities = await commonManagedRuntimeIdentities(document, home, "codex", ["SessionStart", "UserPromptSubmit", "Stop"]);
      lingerHooks = runtimeIdentities.length > 0;
    } catch { /* malformed or unsupported host config */ }
  }
  let liveSession: VerifiedLiveSession | undefined;
  let invalidEvidence = false;
  try {
    const vault = path.join(home, ".linger", "vault");
    liveSession = await verifiedCodexLifecycleSession(vault, runtimeIdentities);
  }
  catch { invalidEvidence = true; }
  const live = Boolean(installed && lingerHooks && liveSession);
  const level: CapabilityLevel = live ? 2 : installed ? 1 : 0;
  const evidence = [
    detected ? root : "Codex directory not found",
    hookEvidence ? `${hookEvidence} (configured${live ? "; live lifecycle verified" : "; execution trust unverified"})` : "No hook configuration detected",
    ...(liveSession ? [`Observed SessionStart, UserPromptSubmit capture, and Stop capture in Codex session ${liveSession.session_id}`] : [])
  ];
  const limitations = [
    ...(live ? ["Live lifecycle evidence proves prior execution; changing hooks may require a new Codex session and renewed verification."] : ["Codex hook configuration does not prove execution trust; capability remains L1 until one live session completes the required lifecycle."]),
    ...(invalidEvidence ? ["Codex live evidence is invalid and was ignored."] : []),
    "When lifecycle coverage is incomplete, use rule-driven explicit CLI capture."
  ];
  return result("codex", detected, installed, level, live, evidence, limitations);
}

function result(adapter: AdapterName, detected: boolean, installed: boolean, level: CapabilityLevel, hooks: boolean, evidence: string[], limitations: string[]): AdapterCapability {
  return { adapter, detected, installed, level, capabilities: { rules: installed, file_access: installed, lifecycle_hooks: hooks, async_processing: false, recovery: hooks }, evidence, limitations };
}
async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }
async function firstExisting(files: string[]): Promise<string | undefined> {
  for (const file of files) if (await exists(file)) return file;
  return undefined;
}

async function commonManagedRuntimeIdentities(
  document: { hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>> },
  home: string,
  adapter: AdapterName,
  required: string[]
): Promise<string[]> {
  const identities: Array<Set<string>> = [];
  for (const event of required) {
    const verified = new Set<string>();
    for (const hook of (document.hooks?.[event] ?? []).flatMap(group => group.hooks ?? [])) {
      const parsed = typeof hook.command === "string" ? parseManagedHookCommand(hook.command, home, adapter) : undefined;
      if (!parsed?.runtime_identity) continue;
      const packageRoot = path.dirname(path.dirname(parsed.hook));
      try {
        await assertReadableInside(home, parsed.hook);
        if (await runtimeFingerprint(packageRoot, parsed.node) === parsed.runtime_identity) verified.add(parsed.runtime_identity);
      } catch { /* invalid or changed runtimes remain untrusted */ }
    }
    identities.push(verified);
  }
  const first = identities[0];
  return first ? [...first].filter(identity => identities.every(values => values.has(identity))) : [];
}
