import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installRuntime, uninstallRuntime } from "./runtime-installer.js";

test("copies a stable versioned runtime and replaces it idempotently", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-runtime-"));
  const first = await installRuntime(home, process.cwd());
  await access(path.join(first.root, "dist", "hook-cli.js"));
  const second = await installRuntime(home, process.cwd());
  assert.equal(first.root, second.root);
  assert.equal(await uninstallRuntime(home, second.root), true);
});

test("refuses unmanaged or out-of-scope runtime deletion", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-runtime-"));
  const unmanaged = path.join(home, ".continuity", "runtime", "custom");
  await mkdir(unmanaged, { recursive: true });
  await writeFile(path.join(unmanaged, "keep"), "keep");
  await assert.rejects(installRuntime(home, path.join(home, "missing-package")));
  assert.equal(await uninstallRuntime(home, unmanaged), false);
  await assert.rejects(uninstallRuntime(home, path.join(home, "outside")), /outside managed root/);
});

test("rejects a package version that could escape the managed runtime directory", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-runtime-"));
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), "continuity-runtime-package-"));
  await mkdir(path.join(packageRoot, "dist"), { recursive: true });
  await writeFile(path.join(packageRoot, "dist", "hook-cli.js"), "runtime");
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ version: "../../escape" }));
  await assert.rejects(installRuntime(home, packageRoot), /Invalid package version/);
  await assert.rejects(access(path.join(home, "escape")));
});
