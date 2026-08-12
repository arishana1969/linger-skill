#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const patterns = [
  ["private_key", /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/],
  ["aws_access_key", /AKIA[0-9A-Z]{16}/],
  ["github_token", /ghp_[A-Za-z0-9]{36}/],
  ["openai_style_key", /sk-[A-Za-z0-9]{20,}/],
  ["slack_token", /xox[baprs]-[A-Za-z0-9-]{10,}/]
];
const { stdout } = await exec("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "buffer" });
const files = stdout.toString("utf8").split("\0").filter(Boolean);
const findings = [];
let scannedFiles = 0;
for (const file of files) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (bytes.includes(0)) continue;
  scannedFiles += 1;
  const content = bytes.toString("utf8");
  for (const [rule, pattern] of patterns) if (pattern.test(content)) findings.push({ file, rule });
}
if (findings.length) {
  process.stderr.write(`${JSON.stringify({ ok: false, findings }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, scanned_files: scannedFiles })}\n`);
}
