import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { assertReadableInside, assertWritableInside, atomicWrite, ensureDir } from "../io.js";
import { resolveEffectiveSearchDocuments, type EffectiveSearchDocument } from "../effective-search-document.js";
import { assertSafeId, vaultPaths } from "../paths.js";
import { resolveSettings } from "../settings.js";

export interface EmbeddingIndexRecord {
  ordinal: number;
  memory_id: string;
  effective_content_hash: string;
  evidence_digest: string;
  memory_identity: string;
  control_identity: string;
  overlay_identity?: string;
  source_savepoint_status: "complete";
  created_at: string;
  vector_offset: number;
}

export interface EmbeddingIndexManifest {
  schema_version: 1;
  index_format: "linger-flat-f32/v1";
  generation_id: string;
  project_id: string;
  profile_id: string;
  backend_kind: "local";
  runtime_identity: string;
  model_identity: string;
  dimension: number;
  metric: "cosine";
  normalization: "l2";
  content_schema_version: "linger-effective-search-document/v1";
  input_policy_id: string;
  chunking_identity: "whole-effective-document/v1";
  vector_count: number;
  records_bytes: number;
  vectors_bytes: number;
  records_sha256: string;
  vectors_sha256: string;
  document_set_digest: string;
  created_at: string;
  completed_at: string;
  builder_runtime_identity: string;
}

export interface EmbeddingBatcher {
  (inputs: string[], expectedDimension: number): Promise<{ dimension: number; vectors: number[][] }>;
}

export interface SemanticHit {
  memory_id: string;
  similarity: number;
  effective_content_hash: string;
  evidence_digest: string;
}

export async function buildEmbeddingIndex(
  root: string,
  input: {
    projectId: string;
    profileId: string;
    runtimeIdentity: string;
    modelIdentity: string;
    dimension: number;
    inputPolicyId: string;
    prepareInput(canonicalText: string): string;
    embed: EmbeddingBatcher;
    now?: Date;
  }
): Promise<{ generation_id: string; vector_count: number; dimension: number; manifest_sha256: string }> {
  const projectId = assertSafeId(input.projectId, "project id");
  const profileId = assertSafeId(input.profileId, "embedding profile id");
  const settings = await resolveSettings(root, { projectId });
  if (settings.values["embedding.desired_enabled"].value !== true
    || settings.values["embedding.profile_id"].value !== profileId) {
    throw new Error("embedding.project_not_authorized");
  }
  if (!/^[a-f0-9]{64}$/.test(input.runtimeIdentity)) throw new Error("embedding.runtime_identity_invalid");
  if (!validIdentity(input.modelIdentity) || !validIdentity(input.inputPolicyId)) throw new Error("embedding.model_identity_invalid");
  if (!Number.isInteger(input.dimension) || input.dimension < 1 || input.dimension > 16_384) throw new Error("embedding.dimension_invalid");
  const documents = (await resolveEffectiveSearchDocuments(root, projectId, { maxFiles: 20_000 }))
    .filter(document => document.eligibility.index)
    .sort((left, right) => compareUtf8(left.memory_id, right.memory_id));
  if (!documents.length) throw new Error("embedding.content_ineligible");
  if (documents.length > 20_000) throw new Error("embedding.index_capacity_exceeded");

  const generationId = `gen_${randomUUID().replaceAll("-", "")}`;
  const buildId = `build_${randomUUID().replaceAll("-", "")}`;
  const p = vaultPaths(root);
  const buildDir = path.join(p.embeddings, projectId, "build", buildId);
  const generationDir = path.join(p.embeddings, projectId, "generations", generationId);
  await assertWritableInside(p.root, buildDir);
  await assertWritableInside(p.root, generationDir);
  await ensureDir(buildDir);
  try {
    const allVectors: number[][] = [];
    for (let index = 0; index < documents.length; index += 16) {
      const batch = documents.slice(index, index + 16);
      const prepared = batch.map(document => input.prepareInput(document.canonical_text));
      assertPreparedInputs(prepared);
      const result = await input.embed(prepared, input.dimension);
      if (result.dimension !== input.dimension || result.vectors.length !== batch.length) {
        throw new Error("embedding.response_dimension_mismatch");
      }
      allVectors.push(...result.vectors.map(vector => normalize(vector, input.dimension)));
    }
    const sanityInput = input.prepareInput(documents[0]!.canonical_text);
    assertPreparedInputs([sanityInput]);
    const sanity = await input.embed([sanityInput], input.dimension);
    const sanityVector = normalize(sanity.vectors[0] ?? [], input.dimension);
    if (dot(sanityVector, allVectors[0]!) < 0.999) throw new Error("embedding.sanity_failed");

    const records = documents.map((document, ordinal): EmbeddingIndexRecord => ({
      ordinal,
      memory_id: document.memory_id,
      effective_content_hash: document.effective_content_hash,
      evidence_digest: document.evidence_digest,
      memory_identity: document.memory_identity,
      control_identity: document.control_identity,
      ...(document.overlay_identity ? { overlay_identity: document.overlay_identity } : {}),
      source_savepoint_status: "complete",
      created_at: document.created_at,
      vector_offset: ordinal * input.dimension * 4
    }));
    const recordsBytes = Buffer.from(records.map(record => JSON.stringify(record)).join("\n") + "\n", "utf8");
    const vectorBytes = encodeVectors(allVectors, input.dimension);
    const recordsFile = path.join(buildDir, "records.ndjson");
    const vectorsFile = path.join(buildDir, "vectors.f32");
    await atomicWrite(recordsFile, recordsBytes.toString("utf8"));
    await writeBinary(root, vectorsFile, vectorBytes);
    const now = input.now ?? new Date();
    const manifest: EmbeddingIndexManifest = {
      schema_version: 1,
      index_format: "linger-flat-f32/v1",
      generation_id: generationId,
      project_id: projectId,
      profile_id: profileId,
      backend_kind: "local",
      runtime_identity: input.runtimeIdentity,
      model_identity: input.modelIdentity,
      dimension: input.dimension,
      metric: "cosine",
      normalization: "l2",
      content_schema_version: "linger-effective-search-document/v1",
      input_policy_id: input.inputPolicyId,
      chunking_identity: "whole-effective-document/v1",
      vector_count: records.length,
      records_bytes: recordsBytes.length,
      vectors_bytes: vectorBytes.length,
      records_sha256: sha256(recordsBytes),
      vectors_sha256: sha256(vectorBytes),
      document_set_digest: sha256(Buffer.from(JSON.stringify(records.map(identityRecord)))),
      created_at: now.toISOString(),
      completed_at: now.toISOString(),
      builder_runtime_identity: sha256(Buffer.from(`${process.version}\0${process.platform}\0${process.arch}`))
    };
    const manifestBytes = jsonBytes(manifest);
    await atomicWrite(path.join(buildDir, "manifest.json"), manifestBytes.toString("utf8"));
    await ensureDir(path.dirname(generationDir));
    await rename(buildDir, generationDir);
    const loaded = await loadGeneration(root, projectId, generationId, sha256(manifestBytes));
    if (loaded.records.length !== records.length) throw new Error("embedding.index_validation_failed");
    const active = {
      schema_version: 1,
      project_id: projectId,
      generation_id: generationId,
      manifest_sha256: sha256(manifestBytes),
      switched_at: now.toISOString()
    };
    const activeFile = path.join(p.embeddings, projectId, "active.json");
    await assertWritableInside(p.root, activeFile);
    await atomicWrite(activeFile, jsonBytes(active).toString("utf8"));
    await loadActiveGeneration(root, projectId);
    return {
      generation_id: generationId,
      vector_count: records.length,
      dimension: input.dimension,
      manifest_sha256: active.manifest_sha256
    };
  } catch (error) {
    await rm(buildDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function searchEmbeddingIndex(
  root: string,
  projectId: string,
  queryVector: number[],
  limit = 50
): Promise<{ hits: SemanticHit[]; stale_rows: number; generation_id: string }> {
  const project = assertSafeId(projectId, "project id");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid semantic result limit");
  const generation = await loadActiveGeneration(root, project);
  const query = normalize(queryVector, generation.manifest.dimension);
  const current = new Map((await resolveEffectiveSearchDocuments(root, project, { maxFiles: 20_000 })).map(document => [document.memory_id, document]));
  const hits: SemanticHit[] = [];
  let staleRows = 0;
  for (const record of generation.records) {
    const document = current.get(record.memory_id);
    if (!document?.eligibility.index || !sameIdentity(record, document)) { staleRows += 1; continue; }
    const vector = decodeVector(generation.vectors, record.vector_offset, generation.manifest.dimension);
    hits.push({ memory_id: record.memory_id, similarity: dot(query, vector), effective_content_hash: record.effective_content_hash, evidence_digest: record.evidence_digest });
  }
  hits.sort((left, right) => right.similarity - left.similarity || compareUtf8(left.memory_id, right.memory_id));
  return { hits: hits.slice(0, limit), stale_rows: staleRows, generation_id: generation.manifest.generation_id };
}

export async function embeddingIndexStatus(root: string, projectId: string): Promise<"missing" | "active" | "failed"> {
  try { await loadActiveGeneration(root, assertSafeId(projectId, "project id")); return "active"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "failed"; }
}

export async function readActiveEmbeddingIndexManifest(root: string, projectId: string): Promise<EmbeddingIndexManifest> {
  return (await loadActiveGeneration(root, assertSafeId(projectId, "project id"))).manifest;
}

export async function deleteEmbeddingIndex(root: string, projectId: string, confirmed: boolean): Promise<{ deleted: true; project_id: string }> {
  if (!confirmed) throw new Error("embedding.delete_confirmation_required");
  const project = assertSafeId(projectId, "project id");
  const target = path.join(vaultPaths(root).embeddings, project);
  await assertReadableInside(root, target);
  await assertWritableInside(root, target);
  if ((await lstat(target)).isSymbolicLink()) throw new Error("embedding.index_invalid");
  await rm(target, { recursive: true });
  return { deleted: true, project_id: project };
}

async function loadActiveGeneration(root: string, projectId: string): Promise<LoadedGeneration> {
  const file = path.join(vaultPaths(root).embeddings, projectId, "active.json");
  await assertReadableInside(root, file);
  const value = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  if (value.schema_version !== 1 || value.project_id !== projectId) throw new Error("embedding.index_invalid");
  if (typeof value.generation_id !== "string" || typeof value.manifest_sha256 !== "string") {
    throw new Error("embedding.index_invalid");
  }
  const generationId = assertSafeId(value.generation_id, "embedding generation id");
  if (!/^[a-f0-9]{64}$/.test(value.manifest_sha256)) throw new Error("embedding.index_invalid");
  return await loadGeneration(root, projectId, generationId, value.manifest_sha256);
}

interface LoadedGeneration { manifest: EmbeddingIndexManifest; records: EmbeddingIndexRecord[]; vectors: Buffer; }

async function loadGeneration(root: string, projectId: string, generationId: string, expectedManifestHash: string): Promise<LoadedGeneration> {
  const dir = path.join(vaultPaths(root).embeddings, projectId, "generations", generationId);
  const manifestFile = path.join(dir, "manifest.json");
  const recordsFile = path.join(dir, "records.ndjson");
  const vectorsFile = path.join(dir, "vectors.f32");
  for (const file of [manifestFile, recordsFile, vectorsFile]) await assertReadableInside(root, file);
  const [manifestBytes, recordsBytes, vectors] = await Promise.all([readFile(manifestFile), readFile(recordsFile), readFile(vectorsFile)]);
  if (sha256(manifestBytes) !== expectedManifestHash) throw new Error("embedding.index_tampered");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  assertManifest(manifest, projectId, generationId);
  if (manifest.records_bytes !== recordsBytes.length || manifest.vectors_bytes !== vectors.length) {
    throw new Error("embedding.index_tampered");
  }
  if (sha256(recordsBytes) !== manifest.records_sha256 || sha256(vectors) !== manifest.vectors_sha256) {
    throw new Error("embedding.index_tampered");
  }
  if (vectors.length !== manifest.vector_count * manifest.dimension * 4) throw new Error("embedding.index_invalid");
  const lines = recordsBytes.toString("utf8").split("\n");
  if (lines.at(-1) !== "") throw new Error("embedding.index_invalid");
  const records = lines.slice(0, -1).map(line => JSON.parse(line) as EmbeddingIndexRecord);
  if (records.length !== manifest.vector_count) throw new Error("embedding.index_invalid");
  records.forEach((record, ordinal) => assertRecord(record, ordinal, manifest.dimension));
  for (let ordinal = 0; ordinal < manifest.vector_count; ordinal += 1) decodeVector(vectors, ordinal * manifest.dimension * 4, manifest.dimension);
  if (sha256(Buffer.from(JSON.stringify(records.map(identityRecord)))) !== manifest.document_set_digest) throw new Error("embedding.index_tampered");
  return { manifest, records, vectors };
}

function assertManifest(value: unknown, projectId: string, generationId: string): asserts value is EmbeddingIndexManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding.index_invalid");
  const item = value as Record<string, unknown>;
  if (item.schema_version !== 1 || item.index_format !== "linger-flat-f32/v1") throw new Error("embedding.index_invalid");
  if (item.project_id !== projectId || item.generation_id !== generationId) throw new Error("embedding.index_invalid");
  if (item.backend_kind !== "local" || item.metric !== "cosine" || item.normalization !== "l2") {
    throw new Error("embedding.index_invalid");
  }
  if (item.content_schema_version !== "linger-effective-search-document/v1"
    || item.chunking_identity !== "whole-effective-document/v1") {
    throw new Error("embedding.index_invalid");
  }
  if (!validIdentity(item.model_identity) || !validIdentity(item.input_policy_id)) throw new Error("embedding.index_invalid");
  if (!Number.isInteger(item.dimension) || Number(item.dimension) < 1) throw new Error("embedding.index_invalid");
  if (!Number.isInteger(item.vector_count) || Number(item.vector_count) < 1 || Number(item.vector_count) > 20_000) {
    throw new Error("embedding.index_invalid");
  }
  for (const key of ["records_bytes", "vectors_bytes"] as const) if (!Number.isInteger(item[key]) || Number(item[key]) < 0) throw new Error("embedding.index_invalid");
  for (const key of ["runtime_identity", "records_sha256", "vectors_sha256", "document_set_digest", "builder_runtime_identity"] as const) {
    if (typeof item[key] !== "string" || !/^[a-f0-9]{64}$/.test(item[key])) {
      throw new Error("embedding.index_invalid");
    }
  }
  assertSafeId(String(item.profile_id ?? ""), "embedding profile id");
  if (typeof item.created_at !== "string" || typeof item.completed_at !== "string") {
    throw new Error("embedding.index_invalid");
  }
  if (!Number.isFinite(Date.parse(item.created_at)) || !Number.isFinite(Date.parse(item.completed_at))) {
    throw new Error("embedding.index_invalid");
  }
}

function assertRecord(record: EmbeddingIndexRecord, ordinal: number, dimension: number): void {
  if (!record || typeof record !== "object" || record.ordinal !== ordinal) throw new Error("embedding.index_invalid");
  if (record.vector_offset !== ordinal * dimension * 4 || record.source_savepoint_status !== "complete") {
    throw new Error("embedding.index_invalid");
  }
  assertSafeId(record.memory_id, "memory id");
  const hashes = [
    record.effective_content_hash,
    record.evidence_digest,
    record.memory_identity,
    record.control_identity,
    ...(record.overlay_identity ? [record.overlay_identity] : [])
  ];
  for (const hash of hashes) if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("embedding.index_invalid");
  if (!Number.isFinite(Date.parse(record.created_at))) throw new Error("embedding.index_invalid");
}

function sameIdentity(record: EmbeddingIndexRecord, document: EffectiveSearchDocument): boolean {
  return record.effective_content_hash === document.effective_content_hash
    && record.evidence_digest === document.evidence_digest
    && record.memory_identity === document.memory_identity
    && record.control_identity === document.control_identity
    && record.overlay_identity === document.overlay_identity;
}

function identityRecord(record: EmbeddingIndexRecord): object {
  return {
    memory_id: record.memory_id,
    effective_content_hash: record.effective_content_hash,
    evidence_digest: record.evidence_digest,
    memory_identity: record.memory_identity,
    control_identity: record.control_identity,
    overlay_identity: record.overlay_identity
  };
}

function normalize(vector: number[], dimension: number): number[] {
  if (vector.length !== dimension || !vector.every(Number.isFinite)) throw new Error("embedding.response_dimension_mismatch");
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) throw new Error("embedding.response_non_finite");
  return vector.map(value => value / norm);
}

function encodeVectors(vectors: number[][], dimension: number): Buffer {
  const buffer = Buffer.alloc(vectors.length * dimension * 4);
  vectors.forEach((vector, row) => vector.forEach((value, column) => buffer.writeFloatLE(value, (row * dimension + column) * 4)));
  return buffer;
}

function decodeVector(buffer: Buffer, offset: number, dimension: number): number[] {
  if (offset < 0 || offset + dimension * 4 > buffer.length) throw new Error("embedding.index_invalid");
  const vector = Array.from({ length: dimension }, (_, index) => buffer.readFloatLE(offset + index * 4));
  if (!vector.every(Number.isFinite)) throw new Error("embedding.index_invalid");
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (Math.abs(norm - 1) > 0.001) throw new Error("embedding.index_invalid");
  return vector;
}

function dot(left: number[], right: number[]): number { return left.reduce((sum, value, index) => sum + value * right[index]!, 0); }
function validIdentity(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
function assertPreparedInputs(inputs: string[]): void {
  if (inputs.some(value => typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > 65_536)) throw new Error("embedding.input_invalid");
}
function jsonBytes(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function compareUtf8(left: string, right: string): number { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }

async function writeBinary(root: string, file: string, bytes: Buffer): Promise<void> {
  await assertWritableInside(vaultPaths(root).root, file);
  const { open } = await import("node:fs/promises");
  await ensureDir(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
}
