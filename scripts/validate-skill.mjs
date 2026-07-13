#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseScalar(raw, label) {
  const value = raw.trim();
  if (!value || value === "|" || value === ">" || value === "|-" || value === ">-") {
    throw new Error(`${label} must be a single-line scalar`);
  }
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error();
      return parsed;
    } catch {
      throw new Error(`${label} has an invalid quoted scalar`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(`${label} has an invalid quoted scalar`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.includes(" #")) return value.slice(0, value.indexOf(" #")).trimEnd();
  return value;
}

function readFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL.md requires YAML frontmatter");
  const metadata = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!entry) throw new Error("frontmatter must use single-line key/value fields");
    if (metadata.has(entry[1])) throw new Error(`duplicate frontmatter field: ${entry[1]}`);
    metadata.set(entry[1], parseScalar(entry[2], entry[1]));
  }
  const keys = [...metadata.keys()].sort();
  if (keys.join(",") !== "description,name") throw new Error("frontmatter must contain only name and description");
  return Object.fromEntries(metadata);
}

function readDefaultPrompt(content) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => /^interface:\s*(?:#.*)?$/.test(line));
  if (start < 0) throw new Error("agents/openai.yaml requires an interface mapping");
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !/^\s/.test(line)) break;
    const match = line.match(/^\s+default_prompt:\s*(.*)$/);
    if (match) return parseScalar(match[1], "default_prompt");
  }
  throw new Error("agents/openai.yaml requires interface.default_prompt");
}

function main() {
  const skill = path.resolve(process.argv[2] ?? "skills/continuity");
  const document = path.join(skill, "SKILL.md");
  const interfacePath = path.join(skill, "agents", "openai.yaml");
  if (!fs.statSync(document, { throwIfNoEntry: false })?.isFile()) throw new Error(`missing ${document}`);
  if (!fs.statSync(interfacePath, { throwIfNoEntry: false })?.isFile()) throw new Error(`missing ${interfacePath}`);

  const metadata = readFrontmatter(fs.readFileSync(document, "utf8"));
  if (metadata.name !== path.basename(skill) || !/^[a-z0-9-]{1,63}$/.test(metadata.name)) {
    throw new Error("invalid skill name");
  }
  if (metadata.description.trim().length < 40) throw new Error("description is too short");
  const prompt = readDefaultPrompt(fs.readFileSync(interfacePath, "utf8"));
  if (!prompt.includes(`$${metadata.name}`)) throw new Error("default_prompt must mention the skill");
  console.log("Skill is valid!");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
