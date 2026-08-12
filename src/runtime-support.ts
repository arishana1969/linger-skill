import { lstat } from "node:fs/promises";
import path from "node:path";

export const SUPPORTED_NODE_MAJORS = [22, 24, 26] as const;

export function assertSupportedNodeVersion(version = process.versions.node): number {
  const match = /^(\d+)\./.exec(version);
  const major = match ? Number(match[1]) : Number.NaN;
  if (!SUPPORTED_NODE_MAJORS.includes(major as 22 | 24 | 26)) {
    throw new Error(`runtime.unsupported_node:${Number.isInteger(major) ? major : "unknown"}:supported=22,24,26`);
  }
  return major;
}

export async function assertSupportedRuntime(): Promise<{ node_major: number; node_path: string }> {
  const major = assertSupportedNodeVersion();
  if (!path.isAbsolute(process.execPath)) throw new Error("runtime.node_path_invalid");
  const info = await lstat(process.execPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("runtime.node_path_invalid");
  return { node_major: major, node_path: process.execPath };
}
