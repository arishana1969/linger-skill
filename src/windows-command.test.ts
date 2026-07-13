import assert from "node:assert/strict";
import test from "node:test";
import { windowsCommand } from "./windows-command.js";

test("converts POSIX adapter assignment to PowerShell override", () => {
  const result = windowsCommand('LINGER_ADAPTER=codex "C:\\Program Files\\node.exe" "C:\\Users\\A B\\hook-cli.js"');
  assert.match(result, /^powershell\.exe -NoProfile/);
  assert.match(result, /\$env:LINGER_ADAPTER='codex'/);
  assert.match(result, /Program Files/);
});
