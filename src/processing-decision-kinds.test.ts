import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { getDecisionTrail } from "./decisions.js";
import { processQueue } from "./processing.js";

test("processing records every visible decision-trail kind as an append-only event", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-processing-kinds-"));
  const cases = [
    ["idea", "Idea: offline import"],
    ["preference", "Preference: human-readable files"],
    ["proposal", "Proposal: batch queue writes"],
    ["reason", "Reason: reproducibility matters"],
    ["constraint", "Constraint: must avoid daemon mode"],
    ["reject", "Reject remote sync"],
    ["decided", "Decided to use JSON files"],
    ["adapter", "Current adapter state uses hooks"],
    ["todo", "Todo: benchmark parser latency"]
  ] as const;
  for (const [topic, content] of cases) await capture(root, { projectId: "p", sessionId: `s_${topic}`, turnId: `t_${topic}`, role: "user", content, sourceAgent: "test" });
  await processQueue(root);
  const expected = ["idea", "preference", "proposal", "rationale", "constraint", "rejection", "decision", "current_state", "todo"];
  for (let index = 0; index < cases.length; index += 1) {
    const trail = await getDecisionTrail(root, "p", cases[index]![0]);
    assert.equal(trail?.events[0]?.kind, expected[index]);
    assert.equal(trail?.events[0]?.evidence_refs.length, 1);
  }
});
