import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedNodeVersion } from "./runtime-support.js";

test("runtime support accepts supported even-numbered Node releases", () => {
  assert.equal(assertSupportedNodeVersion("22.0.0"), 22);
  assert.equal(assertSupportedNodeVersion("24.14.0"), 24);
  assert.equal(assertSupportedNodeVersion("26.7.0"), 26);
  for (const version of ["20.20.0", "23.1.0", "25.0.0", "27.0.0", "invalid"]) {
    assert.throws(() => assertSupportedNodeVersion(version), /runtime\.unsupported_node/);
  }
});
