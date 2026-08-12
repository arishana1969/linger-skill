import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { AdapterName } from "./adapters.js";
import { assertReadableInside, assertWritableInside, atomicJson, ensureDir } from "./io.js";
import { vaultPaths } from "./paths.js";

export interface SessionControlStatus {
  token: string;
  capture: "on" | "off";
}

interface SessionControlRecord {
  schema_version: 1;
  token: string;
  disabled_at: string;
}

export function sessionControlToken(adapter: AdapterName, sessionId: string): string {
  if (!sessionId.trim()) throw new Error("session.id_required");
  return createHash("sha256").update(`${adapter}\0${sessionId}`).digest("hex");
}

export async function sessionControlStatus(root: string, tokenInput: string): Promise<SessionControlStatus> {
  const token = validToken(tokenInput);
  const file = controlFile(root, token);
  try {
    await assertReadableInside(root, file);
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    assertSessionControl(value, token);
    return { token, capture: "off" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { token, capture: "on" };
    throw error;
  }
}

export async function disableSession(root: string, tokenInput: string): Promise<SessionControlStatus> {
  const token = validToken(tokenInput);
  const file = controlFile(root, token);
  await ensureDir(vaultPaths(root).root);
  await assertWritableInside(root, file);
  await ensureDir(path.dirname(file));
  const record: SessionControlRecord = { schema_version: 1, token, disabled_at: new Date().toISOString() };
  await atomicJson(file, record);
  return { token, capture: "off" };
}

export async function enableSession(root: string, tokenInput: string): Promise<SessionControlStatus> {
  const token = validToken(tokenInput);
  const file = controlFile(root, token);
  try {
    await assertWritableInside(root, file);
    await rm(file, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { token, capture: "on" };
}

function controlFile(root: string, token: string): string {
  return path.join(vaultPaths(root).registry, "session-controls", `${token}.json`);
}

export function assertSessionControlRecord(root: string, file: string, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("session.control_invalid");
  const token = validToken((value as { token?: unknown }).token as string);
  assertSessionControl(value, token);
  if (path.resolve(file) !== path.resolve(controlFile(root, token))) throw new Error("session.control_path_invalid");
}

function validToken(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("session.token_invalid");
  return value;
}

function assertSessionControl(value: unknown, token: string): asserts value is SessionControlRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("session.control_invalid");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 3 || item.schema_version !== 1 || item.token !== token || typeof item.disabled_at !== "string" || !Number.isFinite(Date.parse(item.disabled_at))) {
    throw new Error("session.control_invalid");
  }
}
