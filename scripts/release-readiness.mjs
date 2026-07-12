#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(option("--root") ?? process.cwd());
const blockers = [];
const manifest = await json(path.join(root, "package.json"), "package_json");
const security = await text(path.join(root, "SECURITY.md"));
const license = await text(path.join(root, "LICENSE"));

if (!license?.trim()) blockers.push("license_file");
if (!manifest || typeof manifest.license !== "string" || !manifest.license.trim() || manifest.license === "UNLICENSED") blockers.push("package_license");
if (!urlField(manifest?.repository)) blockers.push("repository_url");
if (!urlField(manifest?.homepage)) blockers.push("homepage_url");
if (!urlField(manifest?.bugs)) blockers.push("bugs_url");
if (!securityContact(security)) blockers.push("security_contact");

const report = {
  github_ready: blockers.length === 0,
  blockers,
  external_steps: ["Confirm npm package name ownership before publication", "Run the clean-checkout gate again after release metadata changes"]
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (blockers.length && !process.argv.includes("--allow-blocked")) process.exitCode = 1;

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function text(file) { try { return await readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } }
async function json(file, blocker) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${path.basename(file)}`);
    return value;
  } catch (error) {
    if (error.code === "ENOENT") { blockers.push(blocker); return undefined; }
    throw error;
  }
}
function urlField(value) {
  const candidate = typeof value === "string" ? value : value && typeof value === "object" && typeof value.url === "string" ? value.url : undefined;
  return Boolean(candidate && /^(?:https:\/\/|git\+https:\/\/)/.test(candidate));
}
function securityContact(value) {
  if (!value) return false;
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) || /https:\/\/github\.com\/[^\s)]+\/security\/advisories\/new/i.test(value);
}
