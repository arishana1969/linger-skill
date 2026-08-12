import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { assertReadableInside, assertWritableInside, ensureDir } from "../io.js";
import { assertSafeId, assertSafeRelativePosixPath, vaultPaths } from "../paths.js";

export type LocalArtifactIntegrity =
  | { algorithm: "sha256"; digest: string }
  | { algorithm: "sha512-sri"; digest: string }
  | { algorithm: "git-blob-sha1"; digest: string };

export interface LocalArtifactSpec {
  artifact_id: string;
  relative_path: string;
  source_url: string;
  max_bytes: number;
  integrity: LocalArtifactIntegrity;
  redirect?: { max_hops: 1 | 2; allowed_hosts: string[]; query_in_memory_only: true };
}

export interface LocalArtifactBudget {
  max_bytes: number;
  used_bytes: number;
  max_requests: number;
  used_requests: number;
}

export interface LocalArtifactReceipt {
  artifact_id: string;
  relative_path: string;
  bytes: number;
  sha256: string;
  integrity_verified: true;
  acquisition_source: "downloaded" | "predecessor_reverified";
  source_endpoint: string;
  redirect_count: number | null;
}

export async function downloadLocalArtifact(
  root: string,
  transactionId: string,
  spec: LocalArtifactSpec,
  budget: LocalArtifactBudget,
  options: { totalTimeoutMs?: number; bodyIdleTimeoutMs?: number; maxHeaderBytes?: number; maxWriteBytes?: number } = {}
): Promise<LocalArtifactReceipt> {
  const transaction = assertSafeId(transactionId, "Local artifact transaction id");
  assertArtifactSpec(spec);
  assertBudget(budget);
  const target = path.join(vaultPaths(root).modelCache, "staging", transaction, safeRelativePath(spec.relative_path));
  await assertWritableInside(root, target);
  await ensureDir(path.dirname(target));
  await assertPrivateCachePath(root, target);

  const totalTimeoutMs = bounded(options.totalTimeoutMs ?? 180_000, 1_000, 600_000, "total timeout");
  const bodyIdleTimeoutMs = bounded(options.bodyIdleTimeoutMs ?? 15_000, 1_000, 60_000, "body idle timeout");
  const maxHeaderBytes = bounded(options.maxHeaderBytes ?? 65_536, 1_024, 262_144, "header cap");
  const maxWriteBytes = bounded(options.maxWriteBytes ?? 65_536, 1_024, 1_048_576, "write cap");
  let handle;
  try {
    handle = await open(target, "wx", 0o600);
    const observed = await requestToFile(spec, handle, budget, { totalTimeoutMs, bodyIdleTimeoutMs, maxHeaderBytes, maxWriteBytes });
    await handle.sync();
    await handle.close();
    handle = undefined;

    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== observed.bytes) throw new Error("embedding.artifact_identity_invalid");
    await assertReadableInside(root, target);
    const verified = await hashFile(target, spec.integrity.algorithm, observed.bytes);
    if (!digestMatches(spec.integrity, verified)) throw new Error("embedding.artifact_integrity_mismatch");
    const postSha256 = await hashFile(target, "sha256", observed.bytes);
    if (postSha256 !== observed.sha256) throw new Error("embedding.artifact_postwrite_mismatch");
    return {
      artifact_id: spec.artifact_id,
      relative_path: spec.relative_path,
      bytes: observed.bytes,
      sha256: postSha256,
      integrity_verified: true,
      acquisition_source: "downloaded",
      source_endpoint: observed.endpoint,
      redirect_count: observed.redirects
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function verifyLocalArtifact(root: string, transactionId: string, spec: LocalArtifactSpec): Promise<LocalArtifactReceipt> {
  const transaction = assertSafeId(transactionId, "Local artifact transaction id");
  assertArtifactSpec(spec);
  const target = path.join(vaultPaths(root).modelCache, "staging", transaction, safeRelativePath(spec.relative_path));
  await assertReadableInside(root, target);
  await assertPrivateCachePath(root, target);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("embedding.artifact_identity_invalid");
  if (info.size < 1 || info.size > spec.max_bytes) throw new Error("embedding.artifact_identity_invalid");
  if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())) {
    throw new Error("embedding.artifact_identity_invalid");
  }
  const verified = await hashFile(target, spec.integrity.algorithm, info.size);
  if (!digestMatches(spec.integrity, verified)) throw new Error("embedding.artifact_integrity_mismatch");
  return {
    artifact_id: spec.artifact_id,
    relative_path: spec.relative_path,
    bytes: info.size,
    sha256: await hashFile(target, "sha256", info.size),
    integrity_verified: true,
    acquisition_source: "predecessor_reverified",
    source_endpoint: endpoint(parseSource(spec.source_url, false)),
    redirect_count: null
  };
}

async function requestToFile(
  spec: LocalArtifactSpec,
  handle: Awaited<ReturnType<typeof open>>,
  budget: LocalArtifactBudget,
  limits: { totalTimeoutMs: number; bodyIdleTimeoutMs: number; maxHeaderBytes: number; maxWriteBytes: number }
): Promise<{ bytes: number; sha256: string; endpoint: string; redirects: number }> {
  const initial = parseSource(spec.source_url, false);
  let current = initial;
  let redirects = 0;
  const deadline = Date.now() + limits.totalTimeoutMs;
  while (true) {
    const result = await oneRequest(current, handle, spec, budget, limits, Math.max(1, deadline - Date.now()));
    if (!result.redirect) return { bytes: result.bytes, sha256: result.sha256, endpoint: endpoint(current), redirects };
    if (!spec.redirect) throw new Error("embedding.artifact_redirect_forbidden");
    if (redirects >= spec.redirect.max_hops) throw new Error("embedding.artifact_redirect_hops_exceeded");
    const next = parseSource(new URL(result.redirect, current).toString(), true);
    if (!spec.redirect.allowed_hosts.includes(next.hostname)) throw new Error(`embedding.artifact_redirect_host_forbidden:${next.hostname}`);
    redirects += 1;
    current = next;
  }
}

async function oneRequest(
  url: URL,
  handle: Awaited<ReturnType<typeof open>>,
  spec: LocalArtifactSpec,
  budget: LocalArtifactBudget,
  limits: { bodyIdleTimeoutMs: number; maxHeaderBytes: number; maxWriteBytes: number },
  remainingMs: number
): Promise<{ redirect?: string; bytes: number; sha256: string }> {
  consumeRequest(budget);
  return await new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const succeed = (value: { redirect?: string; bytes: number; sha256: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const request = https.request(url, {
      method: "GET",
      headers: { accept: "application/octet-stream", "accept-encoding": "identity", "user-agent": "linger-local-artifact/0.3" },
      agent: false
    });
    timer = setTimeout(() => request.destroy(new Error("embedding.artifact_total_timeout")), remainingMs);
    request.once("response", response => {
      const headerBytes = response.rawHeaders.reduce((sum, value) => sum + Buffer.byteLength(value) + 2, 2);
      if (headerBytes > limits.maxHeaderBytes) { response.destroy(); fail(new Error("embedding.artifact_headers_too_large")); return; }
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const location = response.headers.location;
        if (!location) { fail(new Error("embedding.artifact_redirect_invalid")); return; }
        response.destroy();
        succeed({ redirect: location, bytes: 0, sha256: "" });
        return;
      }
      if (response.statusCode !== 200) { response.destroy(); fail(new Error("embedding.artifact_http_status")); return; }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.destroy();
        fail(new Error("embedding.artifact_encoding_forbidden"));
        return;
      }
      const declared = parseContentLength(response.headers["content-length"]);
      if (declared !== undefined && (declared > spec.max_bytes || budget.used_bytes + declared > budget.max_bytes)) {
        response.destroy();
        fail(new Error("embedding.artifact_size_limit"));
        return;
      }
      response.setTimeout(limits.bodyIdleTimeoutMs, () => response.destroy(new Error("embedding.artifact_body_timeout")));
      const sha256 = createHash("sha256");
      let bytes = 0;
      void (async () => {
        try {
          for await (const raw of response) {
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            if (bytes + chunk.length > spec.max_bytes || budget.used_bytes + chunk.length > budget.max_bytes) throw new Error("embedding.artifact_size_limit");
            for (let offset = 0; offset < chunk.length; offset += limits.maxWriteBytes) {
              const piece = chunk.subarray(offset, Math.min(chunk.length, offset + limits.maxWriteBytes));
              const written = await handle.write(piece);
              if (written.bytesWritten !== piece.length) throw new Error("embedding.artifact_short_write");
            }
            bytes += chunk.length;
            budget.used_bytes += chunk.length;
            sha256.update(chunk);
          }
          if (bytes === 0) throw new Error("embedding.artifact_empty");
          if (declared !== undefined && declared !== bytes) throw new Error("embedding.artifact_length_mismatch");
          succeed({ bytes, sha256: sha256.digest("hex") });
        } catch (error) { request.destroy(); fail(error as Error); }
      })();
    });
    request.once("error", error => fail(error));
    request.end();
  });
}

function assertArtifactSpec(spec: LocalArtifactSpec): void {
  assertSafeId(spec.artifact_id, "Local artifact id");
  safeRelativePath(spec.relative_path);
  parseSource(spec.source_url, false);
  bounded(spec.max_bytes, 1, 512 * 1024 * 1024, "artifact byte cap");
  if (spec.integrity.algorithm === "sha256" && !/^[a-f0-9]{64}$/.test(spec.integrity.digest)) throw new Error("embedding.artifact_manifest_invalid");
  if (spec.integrity.algorithm === "git-blob-sha1" && !/^[a-f0-9]{40}$/.test(spec.integrity.digest)) throw new Error("embedding.artifact_manifest_invalid");
  if (spec.integrity.algorithm === "sha512-sri" && !/^sha512-[A-Za-z0-9+/]{86}==$/.test(spec.integrity.digest)) throw new Error("embedding.artifact_manifest_invalid");
  if (spec.redirect) {
    if (![1, 2].includes(spec.redirect.max_hops)) throw new Error("embedding.artifact_manifest_invalid");
    if (spec.redirect.query_in_memory_only !== true) throw new Error("embedding.artifact_manifest_invalid");
    if (!spec.redirect.allowed_hosts.length) throw new Error("embedding.artifact_manifest_invalid");
    if (spec.redirect.allowed_hosts.some(host => !validHost(host))) {
      throw new Error("embedding.artifact_manifest_invalid");
    }
  }
}

function assertBudget(budget: LocalArtifactBudget): void {
  if (!Number.isInteger(budget.max_bytes) || budget.max_bytes < 1 || budget.max_bytes > 1024 * 1024 * 1024) {
    throw new Error("embedding.artifact_budget_invalid");
  }
  if (!Number.isInteger(budget.used_bytes) || budget.used_bytes < 0 || budget.used_bytes > budget.max_bytes) {
    throw new Error("embedding.artifact_budget_invalid");
  }
  if (!Number.isInteger(budget.max_requests) || budget.max_requests < 1 || budget.max_requests > 72) {
    throw new Error("embedding.artifact_budget_invalid");
  }
  if (!Number.isInteger(budget.used_requests) || budget.used_requests < 0 || budget.used_requests > budget.max_requests) {
    throw new Error("embedding.artifact_budget_invalid");
  }
}

function consumeRequest(budget: LocalArtifactBudget): void {
  assertBudget(budget);
  if (budget.used_requests >= budget.max_requests) throw new Error("embedding.artifact_request_limit");
  budget.used_requests += 1;
}

function parseSource(value: string, redirect: boolean): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("embedding.artifact_url_forbidden");
  if (url.port && url.port !== "443") throw new Error("embedding.artifact_url_forbidden");
  if (!validHost(url.hostname) || url.hash) throw new Error("embedding.artifact_url_forbidden");
  if (!redirect && url.search) throw new Error("embedding.artifact_url_forbidden");
  return url;
}

function safeRelativePath(value: string): string { return assertSafeRelativePosixPath(value, "embedding.artifact_path_invalid"); }

async function hashFile(file: string, algorithm: LocalArtifactIntegrity["algorithm"], bytes: number): Promise<string> {
  const hash = createHash(algorithm === "sha512-sri" ? "sha512" : algorithm === "git-blob-sha1" ? "sha1" : "sha256");
  if (algorithm === "git-blob-sha1") hash.update(`blob ${bytes}\0`);
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  const digest = hash.digest(algorithm === "sha512-sri" ? "base64" : "hex");
  return algorithm === "sha512-sri" ? `sha512-${digest}` : digest;
}

function digestMatches(expected: LocalArtifactIntegrity, observed: string): boolean { return expected.digest === observed; }
function endpoint(url: URL): string { return `${url.protocol}//${url.host}${url.pathname}`; }
function validHost(value: string): boolean { return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value); }
function bounded(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
  return value;
}
function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error("embedding.artifact_content_length_invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("embedding.artifact_content_length_invalid");
  return parsed;
}

async function assertPrivateCachePath(root: string, target: string): Promise<void> {
  const base = vaultPaths(root).modelCache;
  const parent = path.dirname(target);
  const relative = path.relative(base, parent);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("embedding.artifact_path_invalid");
  let current = base;
  for (const part of relative ? ["", ...relative.split(path.sep)] : [""]) {
    if (part) current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("embedding.artifact_cache_invalid");
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("embedding.artifact_cache_permissions");
  }
}
