import { access, readFile } from "node:fs/promises";
import path from "node:path";

export type CapabilityLevel = 0 | 1 | 2 | 3 | 4;
export type AdapterName = "claude-code" | "codex";

export interface AdapterCapability {
  adapter: AdapterName;
  detected: boolean;
  installed: boolean;
  level: CapabilityLevel;
  capabilities: {
    rules: boolean;
    file_access: boolean;
    lifecycle_hooks: boolean;
    async_processing: boolean;
    recovery: boolean;
  };
  evidence: string[];
  limitations: string[];
}

export async function capabilityReport(home: string): Promise<AdapterCapability[]> {
  return [await detectClaudeCode(home), await detectCodex(home)];
}

export async function detectClaudeCode(home: string): Promise<AdapterCapability> {
  const root = path.join(home, ".claude");
  const settings = path.join(root, "settings.json");
  const skill = path.join(root, "skills", "continuity", "SKILL.md");
  const detected = await exists(root);
  const installed = await exists(skill);
  let hooks = false;
  try {
    const parsed = JSON.parse(await readFile(settings, "utf8")) as { hooks?: Record<string, unknown> };
    hooks = Boolean(parsed.hooks && Object.keys(parsed.hooks).length);
  } catch { /* missing or user-owned invalid settings */ }
  const level: CapabilityLevel = hooks && installed ? 2 : installed ? 1 : 0;
  return result("claude-code", detected, installed, level, hooks, [
    "MVP hook coverage depends on installed Claude Code lifecycle events.",
    "Background processing remains session-local; no daemon is installed."
  ], [detected ? root : "Claude Code directory not found", hooks ? settings : "No active hooks detected"]);
}

export async function detectCodex(home: string): Promise<AdapterCapability> {
  const root = path.join(home, ".codex");
  const config = path.join(root, "config.toml");
  const skill = path.join(root, "skills", "continuity", "SKILL.md");
  const detected = await exists(root);
  const installed = await exists(skill);
  let hooks = false;
  try { hooks = /(^|\n)\s*\[hooks(?:\.|\])/m.test(await readFile(config, "utf8")); } catch { /* absent */ }
  const level: CapabilityLevel = hooks && installed ? 2 : installed ? 1 : 0;
  return result("codex", detected, installed, level, hooks, [
    "Automatic final-answer capture must be verified against the installed Codex surface.",
    "When lifecycle coverage is incomplete, use rule-driven explicit CLI capture."
  ], [detected ? root : "Codex directory not found", hooks ? config : "No active hooks detected"]);
}

function result(adapter: AdapterName, detected: boolean, installed: boolean, level: CapabilityLevel, hooks: boolean, limitations: string[], evidence: string[]): AdapterCapability {
  return {
    adapter, detected, installed, level,
    capabilities: { rules: installed, file_access: installed, lifecycle_hooks: hooks, async_processing: false, recovery: hooks },
    evidence, limitations
  };
}

async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }
