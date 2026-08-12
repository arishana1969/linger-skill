import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertSupportedNodeVersion } from "../runtime-support.js";

interface Request { id: number; inputs: string[]; expected_dimension: number; }
interface TransformersModule {
  env: { allowRemoteModels: boolean; allowLocalModels: boolean; useFSCache: boolean; logLevel: number; };
  LogLevel: { ERROR: number };
  pipeline(task: string, model: string, options: Record<string, unknown>): Promise<{
    (inputs: string[], options: Record<string, unknown>): Promise<{ dims: number[]; tolist(): unknown }>;
    dispose(): Promise<void>;
  }>;
}

assertSupportedNodeVersion();
const installRoot = argument("--install-root");
const manifest = JSON.parse(await readFile(path.join(installRoot, "install-manifest.json"), "utf8")) as Record<string, unknown>;
if (manifest.status !== "installed_candidate_validated" || manifest.node !== process.version || manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.dimension !== 768 || manifest.runtime_entry !== "node_modules/@huggingface/transformers/src/transformers.js" || manifest.model_path !== "model") fail("embedding.runtime_install_invalid");

globalThis.fetch = async () => { throw new Error("embedding.network_forbidden"); };
const runtime = await import(pathToFileURL(path.join(installRoot, String(manifest.runtime_entry))).href) as TransformersModule;
runtime.env.allowRemoteModels = false;
runtime.env.allowLocalModels = true;
runtime.env.useFSCache = false;
runtime.env.logLevel = runtime.LogLevel.ERROR;
const extractor = await runtime.pipeline("feature-extraction", path.join(installRoot, String(manifest.model_path)), { dtype: "q8", local_files_only: true });

let pending = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  pending += chunk;
  if (Buffer.byteLength(pending) > 1_100_000) fail("embedding.worker_input_limit");
  while (true) {
    const newline = pending.indexOf("\n");
    if (newline < 0) break;
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    if (!line) fail("embedding.worker_protocol_invalid");
    await respond(line);
  }
}
if (pending) fail("embedding.worker_protocol_invalid");
await extractor.dispose();

async function respond(line: string): Promise<void> {
  let request: Request;
  try { request = JSON.parse(line) as Request; }
  catch { fail("embedding.worker_protocol_invalid"); }
  if (!request! || !Number.isInteger(request!.id) || request!.id < 1 || request!.expected_dimension !== 768 || !Array.isArray(request!.inputs) || request!.inputs.length < 1 || request!.inputs.length > 16 || request!.inputs.some(value => typeof value !== "string" || !value || Buffer.byteLength(value) > 65_536)) fail("embedding.worker_request_invalid");
  try {
    const output = await extractor(request!.inputs, { pooling: "mean", normalize: true });
    if (output.dims.length !== 2 || output.dims[0] !== request!.inputs.length || output.dims[1] !== 768) throw new Error("embedding.response_dimension_mismatch");
    const value = output.tolist();
    if (!Array.isArray(value) || value.length !== request!.inputs.length) throw new Error("embedding.response_dimension_mismatch");
    const vectors = value.map(vector => {
      if (!Array.isArray(vector) || vector.length !== 768 || vector.some(item => typeof item !== "number" || !Number.isFinite(item))) throw new Error("embedding.response_dimension_mismatch");
      return vector;
    });
    process.stdout.write(`${JSON.stringify({ id: request!.id, ok: true, dimension: 768, vectors })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request!.id, ok: false, error: safeError(error) })}\n`);
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || process.argv.length !== 4 || !path.isAbsolute(value)) fail("embedding.worker_argv_invalid");
  return path.resolve(value);
}
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "embedding.worker_failed";
  return /^embedding\.[a-z0-9_.:-]+$/.test(message) ? message : "embedding.worker_failed";
}
function fail(message: string): never { process.stderr.write(`${message}\n`); process.exit(1); }
