import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), "linger-package-smoke-"));
const npmEnv = { ...process.env, npm_config_cache: path.join(temporary, "npm-cache") };

try {
  const pack = await exec("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: root, env: npmEnv });
  const [metadata] = JSON.parse(pack.stdout);
  const packedPaths = metadata.files.map((file) => file.path);
  const forbidden = packedPaths.filter((file) => file.startsWith("src/")
    || file.startsWith("dist/dev/")
    || file.startsWith("eval-data/")
    || file.startsWith("scripts/")
    || /(?:^|\/)fixtures?(?:\/|$)|(?:^|\/)oracle(?:\/|$)|\.test\./.test(file));
  if (forbidden.length) throw new Error(`packed artifact contains forbidden development data: ${forbidden.join(", ")}`);
  const tarball = path.resolve(temporary, metadata.filename);
  const extract = path.join(temporary, "extract");
  await mkdir(extract, { recursive: true });
  await exec("tar", ["-xzf", tarball, "-C", extract]);
  const packageRoot = path.join(extract, "package");
  const required = [
    "README.md", "README.zh-CN.md", "UPGRADING.md", "CHANGELOG.md", "PRIVACY.md", "SECURITY.md", "LICENSE", "dist/cli.js", "dist/hook-cli.js",
    "skills/linger/SKILL.md", "skills/linger/agents/openai.yaml", "skills/linger/references/protocol.md",
    "local-model-manifests/multilingual-e5-base-onnx-q8.json",
    "local-runtime-manifests/darwin-arm64-transformers-4.2.0.json"
  ];
  for (const file of required) await access(path.join(packageRoot, file));
  const packedManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (packedManifest.name !== "linger-skill" || packedManifest.bin?.["linger-skill"] !== "dist/cli.js" || packedManifest.bin?.linger !== "dist/cli.js") throw new Error("packed manifest has an invalid name or CLI bin");
  const consumer = path.join(temporary, "consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(path.join(consumer, "package.json"), JSON.stringify({ name: "linger-package-consumer", private: true }));
  await exec("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: consumer, env: npmEnv });
  const home = path.join(temporary, "home");
  const cli = path.join(consumer, "node_modules", ".bin", process.platform === "win32" ? "linger-skill.CMD" : "linger-skill");
  await access(cli);
  const packagedCli = path.join(consumer, "node_modules", "linger-skill", "dist", "cli.js");
  const installed = JSON.parse((await exec(process.execPath, [packagedCli, "install", "--home", home, "--yes"], { cwd: consumer })).stdout);
  if (!installed.privacy_notice || installed.capabilities.length !== 2) throw new Error("packed installer omitted privacy notice or capability report");
  for (const name of ["linger", "linger-skill"]) {
    const bin = path.join(consumer, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
    if ((await exec(bin, ["--version"], { cwd: consumer })).stdout.trim() !== packedManifest.version) throw new Error(`broken npm binary: ${name}`);
  }
  const stableCli = installed.cli.path;
  // An npx/package-manager cache is not part of the managed runtime's lifetime.
  await rm(path.join(consumer, "node_modules"), { recursive: true, force: true });
  if ((await exec(stableCli, ["--version"])).stdout.trim() !== packedManifest.version) throw new Error("managed runtime lost package metadata");
  if (process.platform === "darwin" && process.arch === "arm64") {
    await exec(stableCli, ["embedding-install-plan"]);
  }
  await exec(stableCli, ["install", "--home", home, "--yes"]);
  if (process.platform !== "win32") {
    const env = { ...process.env, PATH: `${path.dirname(stableCli)}${path.delimiter}/usr/bin:/bin` };
    if ((await exec("/bin/sh", ["-c", "linger --version"], { env })).stdout.trim() !== packedManifest.version) throw new Error("managed CLI cannot run from a fresh shell PATH");
  }
  const capabilities = JSON.parse((await exec(stableCli, ["capabilities", "--home", home], { cwd: consumer })).stdout);
  if (capabilities[0]?.level !== 2 || capabilities[1]?.level !== 1) throw new Error("packed capability report did not preserve Claude L2 and trust-gated Codex L1");
  const vault = path.join(home, ".linger", "vault");
  await exec(stableCli, ["capture", "--vault", vault, "--project", "p_consumer", "--session", "s", "--turn", "t", "--role", "user", "--content", "package-consumer-zephyr durable decision", "--explicit"], { cwd: consumer });
  await exec(stableCli, ["process", "--vault", vault, "--project", "p_consumer"], { cwd: consumer });
  const recalled = JSON.parse((await exec(stableCli, ["recall", "--vault", vault, "--project", "p_consumer", "--query", "package-consumer-zephyr"], { cwd: consumer })).stdout);
  if (recalled.hits?.length !== 1 || !recalled.hits[0]?.snippet?.includes("durable decision")) throw new Error("packed consumer failed capture-to-recall smoke");
  const uninstalled = JSON.parse((await exec(stableCli, ["uninstall", "--home", home, "--yes"], { cwd: consumer })).stdout);
  if (uninstalled.vault_preserved !== true) throw new Error("packed uninstall did not preserve the Vault contract");
  await access(vault);
  console.log(JSON.stringify({ ok: true, tarball: path.basename(tarball), package_manager_install: true, both_npm_bins: true, cache_independent_runtime: true, managed_reinstall: true, capture_to_recall: true, vault_preserved: true, required_files: required.length, forbidden_files: forbidden.length, capabilities: capabilities.map((item) => ({ adapter: item.adapter, level: item.level })) }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
