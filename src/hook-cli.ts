#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { handleHook, type HookInput } from "./hook-handler.js";

async function main(): Promise<void> {
  const payload = await readStdin();
  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid hook payload");
  const input = parsed as HookInput;
  const root = process.env.LINGER_VAULT ?? path.join(os.homedir(), ".linger", "vault");
  const agent = process.env.LINGER_ADAPTER === "claude-code" ? "claude-code" : "codex";
  const runtimeIdentity = /^[a-f0-9]{64}$/.test(process.env.LINGER_RUNTIME_ID ?? "") ? process.env.LINGER_RUNTIME_ID : undefined;
  const result = await handleHook(root, input, agent, runtimeIdentity);
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

main().catch(error => {
  process.stderr.write(`linger hook capture failed: ${(error as Error).message}\n`);
  process.stdout.write("{}\n");
});
