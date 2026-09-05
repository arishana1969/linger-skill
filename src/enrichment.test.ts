import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { capture } from "./capture.js";
import { deleteRecord } from "./delete.js";
import { doctor } from "./doctor.js";
import { commitEnrichment, enrichmentStatus, prepareEnrichmentBatch, type EnrichmentBatch, type EnrichmentSubmission } from "./enrichment.js";
import { processQueue } from "./processing.js";
import { quarantineInvalidFiles } from "./repair.js";
import { search } from "./search.js";
import { readTagRegistry, suggestTags } from "./tag-registry.js";
import { vaultPaths } from "./paths.js";
import { expandTerms, setTermRelation } from "./term-graph.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");

async function fixture(content = "The release workflow should preserve source evidence."): Promise<{ root: string; project: string; batch: EnrichmentBatch }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-enrichment-"));
  const project = "p_enrichment";
  await capture(root, { projectId: project, sessionId: "session", turnId: "turn", role: "user", content, sourceAgent: "codex" });
  await processQueue(root, project);
  const batch = await prepareEnrichmentBatch(root, project);
  assert.ok(batch);
  return { root, project, batch };
}

function submission(batch: EnrichmentBatch, agent: "codex" | "claude-code" = "codex"): EnrichmentSubmission {
  return {
    schema_version: 1,
    batch_id: batch.batch_id,
    project_id: batch.project_id,
    agent,
    model: agent === "codex" ? "current-codex-model" : "current-claude-model",
    items: batch.items.map(item => ({
      memory_id: item.memory_id,
      evidence_refs: item.source_events,
      type: "decision",
      title: "Evidence-preserving release workflow",
      summary: "The user chose a host-model release workflow identified by semantic-orchid because evidence preservation matters.",
      tags: ["Release Workflow", "Evidence"],
      predictive_tags: ["host native", "semantic orchid"],
      retrieval_phrases: ["why the host-model release workflow was chosen", "semantic-orchid decision"]
    }))
  };
}

test("host enrichment improves recall without replacing deterministic processed memory", async () => {
  const { root, project, batch } = await fixture();
  const processedFile = path.join(vaultPaths(root).processed, project, `${batch.items[0]!.memory_id}.json`);
  const baseline = await readFile(processedFile, "utf8");
  assert.equal((await search(root, { projectId: project, query: "semantic-orchid" })).length, 0);

  const committed = await commitEnrichment(root, submission(batch));
  assert.equal(committed.committed, 1);
  assert.equal(await readFile(processedFile, "utf8"), baseline);
  assert.match((await search(root, { projectId: project, query: "semantic-orchid" }))[0]?.snippet ?? "", /host-model release workflow/);
  assert.equal((await search(root, { projectId: project, query: "preserve source evidence" }))[0]?.source, batch.items[0]!.memory_id);
  assert.deepEqual(await enrichmentStatus(root, project), { project_id: project, pending: 0, enriched: 1 });
  assert.ok((await readTagRegistry(root, project))?.entries.some(entry => entry.normalized_tag === "semantic-orchid"));
  const predictive = await suggestTags(root, project, "host native");
  assert.equal(predictive.candidates[0]?.tag, "host-native");
  assert.deepEqual(predictive.candidates[0]?.evidence_refs, batch.items[0]!.source_events);
  // A candidate uses the registry's hyphenated key while this overlay stores "host native".
  await setTermRelation(root, { projectId: project, termA: "project-helper", termB: "host-native", relationType: "alias",
    confidence: 0.9, evidenceRefs: batch.items[0]!.source_events });
  const expanded = (await search(root, { projectId: project, query: "project-helper" }))[0]!;
  assert.equal(expanded.source, batch.items[0]!.memory_id);
  assert.equal(expanded.match_type, "possible_match");
  assert.equal((await expandTerms(root, project, ["host native"])).get("project-helper"), 0.9);
});

test("enrichment is limited to normal evidence and rejects mismatched or tampered sources", async () => {
  const { root, project, batch } = await fixture();
  await capture(root, { projectId: project, sessionId: "sensitive", turnId: "contact", role: "user", content: "Contact me at person@example.com about this decision", sourceAgent: "codex" });
  await processQueue(root, project);
  const next = await prepareEnrichmentBatch(root, project);
  assert.equal(next?.items.length, 1);

  const wrong = submission(batch);
  wrong.items[0]!.evidence_refs = ["evt_not_in_batch"];
  await assert.rejects(commitEnrichment(root, wrong), /evidence mismatch/);

  const unsafe = submission(batch);
  unsafe.items[0]!.summary = "API_KEY=host-output-must-not-persist";
  await assert.rejects(commitEnrichment(root, unsafe), /sensitive content/);
  await assert.rejects(commitEnrichment(root, { ...submission(batch), agent: "unsupported-host" }), /Invalid enrichment agent/);

  const rawFile = path.join(vaultPaths(root).raw, project, "session", `${batch.items[0]!.source_events[0]}.json`);
  const raw = JSON.parse(await readFile(rawFile, "utf8")) as Record<string, unknown>;
  raw.content = "tampered content";
  await writeFile(rawFile, `${JSON.stringify(raw, null, 2)}\n`);
  await assert.rejects(commitEnrichment(root, submission(batch)), /stale or unsafe/);
});

test("doctor and confirmed repair cover enrichment overlays", async () => {
  const { root, project, batch } = await fixture();
  await commitEnrichment(root, submission(batch, "claude-code"));
  const overlay = path.join(vaultPaths(root).enrichments, project, `${batch.items[0]!.memory_id}.json`);
  await writeFile(overlay, "{\"schema_version\":1}\n");
  const unhealthy = await doctor(root);
  assert.equal(unhealthy.ok, false);
  assert.ok(unhealthy.errors.some(error => error.startsWith("invalid_enrichment:")));
  const repaired = await quarantineInvalidFiles(root);
  assert.ok(repaired.quarantined.some(file => file.includes("enrichment")));
  await assert.rejects(access(overlay));
});

test("deleting a processed memory also deletes its derived enrichment", async () => {
  const { root, project, batch } = await fixture();
  await commitEnrichment(root, submission(batch));
  const overlay = path.join(vaultPaths(root).enrichments, project, `${batch.items[0]!.memory_id}.json`);
  await access(overlay);
  await deleteRecord(root, { projectId: project, target: "processed", id: batch.items[0]!.memory_id, confirmed: true });
  await assert.rejects(access(overlay));
});

test("processed deletion refuses an enrichment-directory symlink escape before mutation", async () => {
  const { root, project, batch } = await fixture();
  await commitEnrichment(root, submission(batch));
  const p = vaultPaths(root);
  const memoryId = batch.items[0]!.memory_id;
  const processed = path.join(p.processed, project, `${memoryId}.json`);
  const enrichmentProject = path.join(p.enrichments, project);
  const external = await mkdtemp(path.join(os.tmpdir(), "linger-enrichment-external-"));
  const externalTarget = path.join(external, `${memoryId}.json`);
  await writeFile(externalTarget, "external file must survive\n");
  await rm(enrichmentProject, { recursive: true });
  await symlink(external, enrichmentProject, "dir");

  await assert.rejects(deleteRecord(root, { projectId: project, target: "processed", id: memoryId, confirmed: true }), /escapes Vault through symlink/);
  await access(processed);
  assert.equal(await readFile(externalTarget, "utf8"), "external file must survive\n");
});

test("CLI completes the bounded host-enrichment round trip", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-enrichment-cli-"));
  const project = "p_enrichment_cli";
  await capture(root, { projectId: project, sessionId: "session", turnId: "turn", role: "user", content: "Use glacier-lantern as the durable release label.", sourceAgent: "codex" });
  await processQueue(root, project);

  const pulled = JSON.parse((await exec(process.execPath, [cli, "enrich-pull", "--vault", root, "--project", project])).stdout) as EnrichmentBatch;
  const input = submission(pulled);
  input.items[0]!.summary = "The durable release label is semantic-cascade.";
  input.items[0]!.retrieval_phrases = ["semantic-cascade release label"];
  const inputFile = path.join(root, "submission.json");
  await writeFile(inputFile, `${JSON.stringify(input)}\n`);

  const committed = JSON.parse((await exec(process.execPath, [cli, "enrich-commit", "--vault", root, "--input", inputFile])).stdout) as { committed: number };
  assert.equal(committed.committed, 1);
  const recalled = JSON.parse((await exec(process.execPath, [cli, "search", "--vault", root, "--project", project, "--query", "semantic-cascade"])).stdout) as Array<{ snippet: string }>;
  assert.match(recalled[0]?.snippet ?? "", /semantic-cascade/);
  await assert.rejects(access(path.join(vaultPaths(root).registry, "enrichment-batches", project, `${pulled.batch_id}.json`)));
});
