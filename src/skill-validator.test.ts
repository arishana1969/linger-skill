import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const validator = path.join(process.cwd(), "scripts", "validate-skill.mjs");

function fixture(frontmatter: string, prompt = "Use $sample-skill for this task.") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linger-skill-validator-"));
  const skill = path.join(root, "sample-skill");
  fs.mkdirSync(path.join(skill, "agents"), { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), `---\n${frontmatter}\n---\n\n# Sample\n`);
  fs.writeFileSync(path.join(skill, "agents", "openai.yaml"), `interface:\n  default_prompt: "${prompt}"\n`);
  return skill;
}

test("validates the checked-in Linger skill without third-party Python packages", () => {
  const output = execFileSync(process.execPath, [validator, path.join(process.cwd(), "skills", "linger")], { encoding: "utf8" });
  assert.match(output, /Skill is valid!/);
});

test("rejects extra frontmatter fields", () => {
  const skill = fixture("name: sample-skill\ndescription: This description is deliberately long enough for validation.\nextra: forbidden");
  assert.throws(
    () => execFileSync(process.execPath, [validator, skill], { encoding: "utf8", stdio: "pipe" }),
    /frontmatter must contain only name and description/,
  );
});

test("requires the interface prompt to trigger the validated skill", () => {
  const skill = fixture(
    "name: sample-skill\ndescription: This description is deliberately long enough for validation.",
    "Use a different skill for this task.",
  );
  assert.throws(
    () => execFileSync(process.execPath, [validator, skill], { encoding: "utf8", stdio: "pipe" }),
    /default_prompt must mention the skill/,
  );
});
