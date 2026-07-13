import assert from "node:assert/strict";
import test from "node:test";
import { windowsCommand } from "./windows-command.js";

test("converts POSIX adapter assignment to PowerShell override", () => {
  const runtimeIdentity = "a".repeat(64);
  const result = windowsCommand({ adapter: "codex", runtimeIdentity, node: "C:\\Program Files\\node.exe", hook: "C:\\Users\\A B\\hook-cli.js" });
  assert.match(result, /^powershell\.exe -NoProfile/);
  assert.match(result, /\$env:LINGER_ADAPTER='codex'/);
  assert.ok(result.includes(`$env:LINGER_RUNTIME_ID='${runtimeIdentity}'`));
  assert.match(result, /Program Files/);
});

test("quotes PowerShell paths without expanding embedded expressions", () => {
  const result = windowsCommand({ adapter: "codex", node: "C:\\Node's\\node.exe", hook: "C:\\$(Write-Output pwn)\\hook-cli.js" });
  assert.match(result, /Node''s/);
  assert.ok(result.includes("'C:\\$(Write-Output pwn)\\hook-cli.js'"));
});
