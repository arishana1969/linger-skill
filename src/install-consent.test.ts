import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { confirmPrivacyConsent, parseAdapterSelection } from "./install-consent.js";

test("interactive privacy consent requires exact YES and prints the boundary", async () => {
  const acceptedOutput = new PassThrough();
  let text = "";
  acceptedOutput.on("data", chunk => { text += chunk.toString(); });
  assert.equal(await confirmPrivacyConsent(Readable.from(["YES\n"]), acceptedOutput), true);
  assert.match(text, /local files/i);
  assert.match(text, /model provider configured/i);
  assert.equal(await confirmPrivacyConsent(Readable.from(["yes\n"]), new PassThrough()), false);
  assert.equal(await confirmPrivacyConsent(Readable.from(["NO\n"]), new PassThrough()), false);
});

test("adapter selection defaults to both and rejects unknown adapters", () => {
  assert.deepEqual(parseAdapterSelection(), ["claude-code", "codex"]);
  assert.deepEqual(parseAdapterSelection("codex"), ["codex"]);
  assert.deepEqual(parseAdapterSelection("claude-code,codex,claude-code"), ["claude-code", "codex"]);
  assert.throws(() => parseAdapterSelection("cursor"), /--adapters must/);
  assert.throws(() => parseAdapterSelection(""), /--adapters must/);
});
