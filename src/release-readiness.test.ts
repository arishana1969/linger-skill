import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const script = path.resolve("scripts/release-readiness.mjs");

test("release readiness reports every missing maintainer-owned GitHub field", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-release-readiness-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "example", version: "0.0.1" }));
  await writeFile(path.join(root, "SECURITY.md"), "Contact will be defined later.");
  const result = await exec(process.execPath, [script, "--root", root, "--allow-blocked"]);
  const report = JSON.parse(result.stdout) as { github_ready: boolean; blockers: string[] };
  assert.equal(report.github_ready, false);
  assert.deepEqual(report.blockers.sort(), ["bugs_url", "homepage_url", "license_file", "package_license", "readme_version", "repository_url", "security_contact"]);
});

test("release readiness passes a complete GitHub metadata fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-release-readiness-"));
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "example", version: "0.2.0-alpha.0", license: "MIT", repository: { type: "git", url: "https://github.com/example/repo.git" },
    homepage: "https://github.com/example/repo#readme", bugs: { url: "https://github.com/example/repo/issues" }
  }));
  await writeFile(path.join(root, "LICENSE"), "MIT License");
  await writeFile(path.join(root, "SECURITY.md"), "Report privately to security@example.com.");
  await writeFile(path.join(root, "README.md"), "## Status\n\nExample v0.2.0-alpha.0 candidate.\n");
  const result = await exec(process.execPath, [script, "--root", root]);
  const report = JSON.parse(result.stdout) as { github_ready: boolean; blockers: string[] };
  assert.equal(report.github_ready, true);
  assert.deepEqual(report.blockers, []);
});

test("release readiness accepts a README private-reporting link when SECURITY is intentionally consolidated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-release-readiness-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "example", version: "0.1.0", license: "MIT", repository: { type: "git", url: "https://github.com/example/repo.git" },
    homepage: "https://github.com/example/repo#readme", bugs: { url: "https://github.com/example/repo/issues" }
  }));
  await writeFile(path.join(root, "LICENSE"), "MIT License");
  await writeFile(path.join(root, "README.md"), "## Status\n\nExample v0.1.0 release. Report privately at https://github.com/example/repo/security/advisories/new.\n");
  const result = await exec(process.execPath, [script, "--root", root]);
  const report = JSON.parse(result.stdout) as { github_ready: boolean; blockers: string[] };
  assert.equal(report.github_ready, true);
  assert.deepEqual(report.blockers, []);
});

test("release readiness rejects invalid or undocumented package versions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-release-readiness-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "example", version: "0.2.0-alpha..0", license: "MIT", repository: { type: "git", url: "https://github.com/example/repo.git" },
    homepage: "https://github.com/example/repo#readme", bugs: { url: "https://github.com/example/repo/issues" }
  }));
  await writeFile(path.join(root, "LICENSE"), "MIT License");
  await writeFile(path.join(root, "README.md"), "## Status\n\nExample v0.2.0-alpha.0 candidate. Report privately to security@example.com.\n");
  const invalid = JSON.parse((await exec(process.execPath, [script, "--root", root, "--allow-blocked"])).stdout) as { blockers: string[] };
  assert.ok(invalid.blockers.includes("package_version"));

  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "example", version: "0.2.0-alpha.0", license: "MIT", repository: { type: "git", url: "https://github.com/example/repo.git" },
    homepage: "https://github.com/example/repo#readme", bugs: { url: "https://github.com/example/repo/issues" }
  }));
  await writeFile(path.join(root, "README.md"), "## Status\n\nExample v0.2.0 release. Report privately to security@example.com.\n");
  const undocumented = JSON.parse((await exec(process.execPath, [script, "--root", root, "--allow-blocked"])).stdout) as { blockers: string[] };
  assert.ok(undocumented.blockers.includes("readme_version"));
});
