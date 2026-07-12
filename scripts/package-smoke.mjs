import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), "continuity-package-smoke-"));

try {
  const pack = await runPnpm(["pack", "--json", "--pack-destination", temporary]);
  const metadata = JSON.parse(pack.stdout);
  const tarball = path.resolve(temporary, metadata.filename);
  const extract = path.join(temporary, "extract");
  await mkdir(extract, { recursive: true });
  await exec("tar", ["-xzf", tarball, "-C", extract]);
  const packageRoot = path.join(extract, "package");
  const required = [
    "README.md", "PRIVACY.md", "SECURITY.md", "DATA_MODEL.md", "ADAPTER_SPEC.md", "AGENT_COMPATIBILITY.md", "HOST_VALIDATION.md", "RELEASE_CHECKLIST.md",
    "dist/cli.js", "dist/hook-cli.js", "skills/continuity/SKILL.md", "skills/continuity/agents/openai.yaml"
  ];
  for (const file of required) await access(path.join(packageRoot, file));
  const packedManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (packedManifest.name !== "continuity-skill" || packedManifest.bin?.continuity !== "dist/cli.js") throw new Error("packed manifest has an invalid name or CLI bin");

  const home = path.join(temporary, "home");
  const cli = path.join(packageRoot, "dist", "cli.js");
  const installed = JSON.parse((await exec(process.execPath, [cli, "install", "--home", home, "--yes"], { cwd: packageRoot })).stdout);
  if (!installed.privacy_notice || installed.capabilities.length !== 2) throw new Error("packed installer omitted privacy notice or capability report");
  const capabilities = JSON.parse((await exec(process.execPath, [cli, "capabilities", "--home", home], { cwd: packageRoot })).stdout);
  if (capabilities[0]?.level !== 2 || capabilities[1]?.level !== 1) throw new Error("packed capability report did not preserve Claude L2 and trust-gated Codex L1");
  const uninstalled = JSON.parse((await exec(process.execPath, [cli, "uninstall", "--home", home, "--yes"], { cwd: packageRoot })).stdout);
  if (uninstalled.vault_preserved !== true) throw new Error("packed uninstall did not preserve the Vault contract");
  console.log(JSON.stringify({ ok: true, tarball: path.basename(tarball), required_files: required.length, capabilities: capabilities.map((item) => ({ adapter: item.adapter, level: item.level })) }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function runPnpm(args) {
  const executable = process.env.npm_execpath;
  if (executable) return await exec(process.execPath, [executable, ...args], { cwd: root });
  return await exec("pnpm", args, { cwd: root });
}
