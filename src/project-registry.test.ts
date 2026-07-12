import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { quarantineInvalidFiles } from "./repair.js";
import { listProjects, projectId, registerProject } from "./vault.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");

test("git project without a remote keeps one identity across subdirectories", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "continuity-project-vault-"));
  const repo = await mkdtemp(path.join(os.tmpdir(), "continuity-project-repo-"));
  const nested = path.join(repo, "packages", "app");
  await mkdir(nested, { recursive: true });
  await exec("git", ["init", "-q", repo]);
  assert.equal(await projectId(repo), await projectId(nested));
  const record = await registerProject(vault, nested);
  assert.equal(record.display_name, path.basename(repo));
  assert.equal(record.root_path, await realpath(repo));
  assert.equal(record.identity_source, "git_root");
  assert.deepEqual((await listProjects(vault)).map(item => item.project_id), [record.project_id]);
});

test("project registry skips, diagnoses, and quarantines invalid records", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "continuity-project-integrity-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "continuity-project-path-"));
  const valid = await registerProject(vault, project);
  assert.equal(valid.identity_source, "absolute_path");
  const invalid = path.join(vaultPaths(vault).projects, "invalid.json");
  await writeFile(invalid, JSON.stringify({ schema_version: 1, project_id: "poison" }));
  assert.equal((await listProjects(vault)).length, 1);
  assert.equal((await doctor(vault)).errors.some(value => value.startsWith("invalid_project_record:")), true);
  assert.equal((await quarantineInvalidFiles(vault)).quarantined.length, 1);
  assert.equal((await doctor(vault)).ok, true);
});

test("CLI project-id registers and projects lists without broadening recall", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "continuity-project-cli-vault-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "continuity-project-cli-path-"));
  const id = (await exec(process.execPath, [cli, "project-id", "--vault", vault, "--cwd", project])).stdout.trim();
  const records = JSON.parse((await exec(process.execPath, [cli, "projects", "--vault", vault])).stdout) as Array<{ project_id: string; display_name: string }>;
  assert.equal(records.length, 1);
  assert.equal(records[0]?.project_id, id);
  assert.equal(records[0]?.display_name, path.basename(project));
});

test("registering a project self-heals its invalid derived record", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "continuity-project-heal-vault-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "continuity-project-heal-path-"));
  const id = await projectId(project);
  const file = path.join(vaultPaths(vault).projects, `${id}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ schema_version: 1, project_id: id }));
  const healed = await registerProject(vault, project);
  assert.equal(healed.project_id, id);
  assert.equal((await listProjects(vault)).length, 1);
  assert.equal((await doctor(vault)).ok, true);
});
