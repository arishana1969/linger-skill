import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { listDecisionViews } from "./decisions.js";
import { processQueue } from "./processing.js";

test("derives independent current views for database and database cache", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-decision-topic-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "primary", role: "user", content: "当前数据库决定使用 SQLite", sourceAgent: "test" });
  await capture(root, { projectId: "p", sessionId: "s", turnId: "cache", role: "user", content: "当前数据库缓存决定使用 Redis", sourceAgent: "test" });
  await processQueue(root);
  const views = await listDecisionViews(root, "p");
  assert.deepEqual(views.map(view => view.topic).sort(), ["database", "database-cache"]);
  assert.match(views.find(view => view.topic === "database")?.current_state ?? "", /SQLite/);
  assert.match(views.find(view => view.topic === "database-cache")?.current_state ?? "", /Redis/);
});
