import { createHash } from "node:crypto";
import type { LocalArtifactSpec } from "./local-artifact-download.js";

export interface LocalModelCandidateManifest {
  schema_version: 1;
  status: "candidate_not_validated";
  profile_id: string;
  repository: "onnx-community/multilingual-e5-base-ONNX";
  revision: string;
  declared_license: "mit";
  dtype: "q8";
  pooling: "mean";
  normalization: "l2";
  dimension: 768;
  query_prefix: "query: ";
  passage_prefix: "passage: ";
  files: Array<{ relative_path: string; expected_bytes: number; max_bytes: number; sha256: string }>;
}

export function validateLocalModelCandidateManifest(value: unknown): LocalModelCandidateManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding.model_manifest_invalid");
  const item = value as Record<string, unknown>;
  const keys = [
    "schema_version", "status", "profile_id", "repository", "revision",
    "declared_license", "dtype", "pooling", "normalization", "dimension",
    "query_prefix", "passage_prefix", "files"
  ];
  if (!exactKeys(item, keys)) throw new Error("embedding.model_manifest_invalid");
  if (item.schema_version !== 1 || item.status !== "candidate_not_validated") throw new Error("embedding.model_manifest_invalid");
  if (item.profile_id !== "local-multilingual-e5-base-q8-v1") throw new Error("embedding.model_manifest_invalid");
  if (item.repository !== "onnx-community/multilingual-e5-base-ONNX") throw new Error("embedding.model_manifest_invalid");
  if (item.revision !== "d15bb63d1494d49ff653bb0105592a2696e7a8b6") throw new Error("embedding.model_manifest_invalid");
  if (item.declared_license !== "mit" || item.dtype !== "q8") throw new Error("embedding.model_manifest_invalid");
  if (item.pooling !== "mean" || item.normalization !== "l2" || item.dimension !== 768) throw new Error("embedding.model_manifest_invalid");
  if (item.query_prefix !== "query: " || item.passage_prefix !== "passage: ") throw new Error("embedding.model_manifest_invalid");
  if (!Array.isArray(item.files) || item.files.length !== 5) throw new Error("embedding.model_manifest_invalid");
  const expectedPaths = ["config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];
  item.files.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding.model_manifest_invalid");
    const file = value as Record<string, unknown>;
    if (!exactKeys(file, ["relative_path", "expected_bytes", "max_bytes", "sha256"])) throw new Error("embedding.model_manifest_invalid");
    if (file.relative_path !== expectedPaths[index]) throw new Error("embedding.model_manifest_invalid");
    if (!Number.isInteger(file.expected_bytes) || Number(file.expected_bytes) < 1) throw new Error("embedding.model_manifest_invalid");
    if (!Number.isInteger(file.max_bytes) || Number(file.max_bytes) < 1 || Number(file.max_bytes) > 300 * 1024 * 1024) throw new Error("embedding.model_manifest_invalid");
    if (Number(file.expected_bytes) !== Number(file.max_bytes)) throw new Error("embedding.model_manifest_invalid");
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("embedding.model_manifest_invalid");
  });
  return item as unknown as LocalModelCandidateManifest;
}

export function modelArtifactSpecs(manifest: LocalModelCandidateManifest): LocalArtifactSpec[] {
  return manifest.files.map((file, index) => {
    return {
      artifact_id: `model-${String(index + 1).padStart(3, "0")}`,
      relative_path: `model/${file.relative_path}`,
      source_url: `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${file.relative_path}`,
      max_bytes: file.expected_bytes,
      integrity: { algorithm: "sha256", digest: file.sha256 },
      redirect: {
        max_hops: 2,
        allowed_hosts: [
          "huggingface.co",
          "cas-bridge.xethub.hf.co",
          "cdn-lfs.huggingface.co",
          "us-east-1.aws.xethub.hf.co",
          "us.aws.cdn.hf.co"
        ],
        query_in_memory_only: true
      }
    };
  });
}

export function modelCandidateIdentity(manifest: LocalModelCandidateManifest): string {
  return createHash("sha256").update(`${JSON.stringify(manifest, null, 2)}\n`).digest("hex");
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
