import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("pins every GitHub Action dependency to an immutable commit SHA", async () => {
  const root = path.join(process.cwd(), ".github", "workflows");
  const workflows = (await readdir(root)).filter(name => /\.ya?ml$/.test(name)).sort();
  let dependencies = 0;
  for (const workflow of workflows) {
    const source = await readFile(path.join(root, workflow), "utf8");
    for (const match of source.matchAll(/^\s*-\s+uses:\s+\S+@([^\s#]+)/gm)) {
      dependencies += 1;
      assert.match(match[1] ?? "", /^[a-f0-9]{40}$/, `${workflow} has a mutable or invalid Action ref`);
    }
  }
  assert.ok(dependencies > 0, "no GitHub Action dependencies were checked");
});
