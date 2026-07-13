import type { Readable, Writable } from "node:stream";
import type { AdapterName } from "./adapters.js";
import { PRIVACY_NOTICE } from "./installer.js";

export async function confirmPrivacyConsent(input: Readable, output: Writable): Promise<boolean> {
  output.write(`${PRIVACY_NOTICE}\nType YES to install Linger, or anything else to cancel: `);
  let text = "";
  for await (const chunk of input) {
    text += chunk.toString();
    if (/\r?\n/.test(text)) break;
  }
  return text.split(/\r?\n/, 1)[0]?.trim() === "YES";
}

export function parseAdapterSelection(value?: string): AdapterName[] {
  if (value === undefined) return ["claude-code", "codex"];
  const adapters = [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))];
  if (!adapters.length || adapters.some(item => item !== "claude-code" && item !== "codex")) throw new Error("--adapters must be claude-code, codex, or both comma-separated");
  return adapters as AdapterName[];
}
