import assert from "node:assert/strict";
import test from "node:test";
import { classifySensitivity, redactSecrets } from "./sensitivity.js";

test("classifies multiple credential forms as secret", () => {
  assert.equal(classifySensitivity("API_KEY=abcdefghijklmnop").level, "secret");
  assert.equal(classifySensitivity("Authorization: Bearer abcdefghijklmnopqrstuvwxyz").level, "secret");
  assert.equal(classifySensitivity("-----BEGIN PRIVATE KEY-----\nabc").level, "secret");
  assert.equal(classifySensitivity("contact me at person@example.com").level, "sensitive");
});

test("redacts detected secret values", () => {
  const value = "password=correct-horse-battery-staple";
  const redacted = redactSecrets(value);
  assert.doesNotMatch(redacted, /correct-horse/);
  assert.match(redacted, /REDACTED/);
});
