import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { quarantineInvalidFiles } from "./repair.js";
import { attachProject, confirmProjectIdentity, listProjects, projectId, registerProject } from "./vault.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");

test("git project without a remote keeps one identity across subdirectories", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-project-vault-"));
  const repo = await mkdtemp(path.join(os.tmpdir(), "linger-project-repo-"));
  const nested = path.join(repo, "packages", "app");
  await mkdir(nested, { recursive: true });
  await exec("git", ["init", "-q", repo]);
  assert.equal(await projectId(repo), await projectId(nested));
  const record = await registerProject(vault, nested);
  assert.equal(record.display_name, path.basename(repo));
  assert.equal(record.root_path, await realpath(repo));
  assert.equal(record.identity_source, "git_common_dir");
  assert.deepEqual((await listProjects(vault)).map(item => item.project_id), [record.project_id]);
});

test("project registry skips, diagnoses, and quarantines invalid records", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-project-integrity-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "linger-project-path-"));
  const valid = await registerProject(vault, project);
  assert.equal(valid.identity_source, "absolute_path");
  const invalid = path.join(vaultPaths(vault).projects, "invalid.json");
  await writeFile(invalid, JSON.stringify({ schema_version: 1, project_id: "poison" }));
  assert.equal((await listProjects(vault)).length, 1);
  assert.equal((await doctor(vault)).errors.some(value => value.startsWith("invalid_project_record:")), true);
  assert.equal((await quarantineInvalidFiles(vault)).quarantined.length, 1);
  assert.equal((await doctor(vault)).ok, true);
});

test("CLI project-id is pure and projects lists only registered projects", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-project-cli-vault-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "linger-project-cli-path-"));
  const id = (await exec(process.execPath, [cli, "project-id", "--vault", vault, "--cwd", project])).stdout.trim();
  assert.deepEqual(JSON.parse((await exec(process.execPath, [cli, "projects", "--vault", vault])).stdout), []);
  await registerProject(vault, project);
  const records = JSON.parse((await exec(process.execPath, [cli, "projects", "--vault", vault])).stdout) as Array<{ project_id: string; display_name: string }>;
  assert.equal(records.length, 1);
  assert.equal(records[0]?.project_id, id);
  assert.equal(records[0]?.display_name, path.basename(project));
});

test("project-id reuses a legacy same-root project without rewriting it", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-project-legacy-vault-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "linger-project-legacy-path-"));
  const legacyId = "p_0123456789abcdef";
  const projects = vaultPaths(vault).projects;
  await mkdir(projects, { recursive: true });
  const legacy = {
    schema_version: 1,
    project_id: legacyId,
    display_name: path.basename(project),
    root_path: project,
    identity_source: "absolute_path",
    created_at: "2025-01-01T00:00:00.000Z",
    last_seen: "2025-01-01T00:00:00.000Z"
  };
  const file = path.join(projects, `${legacyId}.json`);
  await writeFile(file, `${JSON.stringify(legacy)}\n`);
  const before = await readFile(file, "utf8");
  assert.equal(await projectId(project, vault), legacyId);
  assert.equal(await readFile(file, "utf8"), before);
});

test("Git common-dir identity survives worktrees and remote changes but isolates clones", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-project-git-vault-"));
  const first = await mkdtemp(path.join(os.tmpdir(), "linger-project-git-first-"));
  const second = await mkdtemp(path.join(os.tmpdir(), "linger-project-git-second-"));
  const worktree = `${first}-worktree`;
  for (const repo of [first, second]) {
    await exec("git", ["init", "-q", repo]);
    await exec("git", ["-C", repo, "config", "user.email", "linger@example.invalid"]);
    await exec("git", ["-C", repo, "config", "user.name", "Linger Test"]);
    await exec("git", ["-C", repo, "remote", "add", "origin", "https://example.invalid/shared.git"]);
    await writeFile(path.join(repo, "README.md"), "fixture\n");
    await exec("git", ["-C", repo, "add", "README.md"]);
    await exec("git", ["-C", repo, "commit", "-qm", "fixture"]);
  }
  await exec("git", ["-C", first, "worktree", "add", "-q", "--detach", worktree]);
  assert.equal(await projectId(first), await projectId(worktree));
  assert.notEqual(await projectId(first), await projectId(second));
  const record = await registerProject(vault, first);
  await exec("git", ["-C", first, "remote", "set-url", "origin", "https://example.invalid/renamed.git"]);
  const changed = await registerProject(vault, worktree);
  assert.equal(changed.project_id, record.project_id);
  assert.equal(changed.identity_changed, true);
  assert.equal((await confirmProjectIdentity(vault, record.project_id, worktree, true)).identity_changed, false);
});

test("a moved non-Git directory requires an explicit empty-scope attachment", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-project-attach-vault-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "linger-project-attach-path-"));
  const original = await registerProject(vault, project);
  const moved = `${project}-moved`;
  await rename(project, moved);
  assert.notEqual(await projectId(moved, vault), original.project_id);
  await attachProject(vault, original.project_id, moved, true);
  assert.equal(await projectId(moved, vault), original.project_id);

  const nonEmpty = await mkdtemp(path.join(os.tmpdir(), "linger-project-attach-nonempty-"));
  const provisional = await projectId(nonEmpty);
  const queue = path.join(vaultPaths(vault).queue, provisional);
  await mkdir(queue, { recursive: true });
  await writeFile(path.join(queue, "pending.json"), "{}\n");
  await assert.rejects(attachProject(vault, original.project_id, nonEmpty, true), /project\.identity_split_requires_manual_migration/);
});

test("registering a project self-heals its invalid derived record", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-project-heal-vault-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "linger-project-heal-path-"));
  const id = await projectId(project);
  const file = path.join(vaultPaths(vault).projects, `${id}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ schema_version: 1, project_id: id }));
  const healed = await registerProject(vault, project);
  assert.equal(healed.project_id, id);
  assert.equal((await listProjects(vault)).length, 1);
  assert.equal((await doctor(vault)).ok, true);
});

test("a locator that points to no project fails closed and is diagnosed", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-project-locator-vault-"));
  const project = await mkdtemp(path.join(os.tmpdir(), "linger-project-locator-path-"));
  const registered = await registerProject(vault, project);
  const locator = path.join(vaultPaths(vault).registry, "project-locators", `${registered.locator_hash}.json`);
  const value = JSON.parse(await readFile(locator, "utf8"));
  value.project_id = "p_missing";
  await writeFile(locator, `${JSON.stringify(value)}\n`);
  await assert.rejects(projectId(project, vault), /project\.identity_locator_invalid/);
  assert.equal((await doctor(vault)).errors.some(error => error.startsWith("invalid_project_locator:")), true);
});
