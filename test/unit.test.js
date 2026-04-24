import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseBool, safeCompare, parseBasicAuth } from "../server.js";

describe("parseBool", () => {
  test("returns fallback when value is undefined or empty", () => {
    assert.equal(parseBool(undefined, true), true);
    assert.equal(parseBool(undefined, false), false);
    assert.equal(parseBool("", true), true);
    assert.equal(parseBool("", false), false);
  });

  test("recognises truthy strings (case-insensitive)", () => {
    for (const v of ["true", "TRUE", "True", "1", "yes", "YES", "on", "ON"]) {
      assert.equal(parseBool(v, false), true, `expected ${v} → true`);
    }
  });

  test("treats anything else as false (regression: Boolean(\"false\") === true)", () => {
    for (const v of ["false", "FALSE", "0", "no", "off", "anything", "  "]) {
      assert.equal(parseBool(v, true), false, `expected ${v} → false`);
    }
  });
});

describe("safeCompare", () => {
  test("equal strings → true", () => {
    assert.equal(safeCompare("abc", "abc"), true);
    assert.equal(safeCompare("", ""), true);
    assert.equal(safeCompare("with spaces", "with spaces"), true);
  });

  test("different lengths → false (without throwing)", () => {
    assert.equal(safeCompare("abc", "abcd"), false);
    assert.equal(safeCompare("longer string", "x"), false);
    assert.equal(safeCompare("", "x"), false);
  });

  test("same length, different content → false", () => {
    assert.equal(safeCompare("abc", "abd"), false);
    assert.equal(safeCompare("AAAA", "BBBB"), false);
  });

  test("non-string inputs → false (defensive)", () => {
    assert.equal(safeCompare(undefined, "x"), false);
    assert.equal(safeCompare("x", undefined), false);
    assert.equal(safeCompare(null, null), false);
    assert.equal(safeCompare(123, "123"), false);
  });
});

describe("parseBasicAuth", () => {
  const enc = (s) => Buffer.from(s).toString("base64");

  test("valid header → { name, pass }", () => {
    const h = `Basic ${enc("alice:secret")}`;
    assert.deepEqual(parseBasicAuth(h), { name: "alice", pass: "secret" });
  });

  test("password may contain colons (split on first only)", () => {
    const h = `Basic ${enc("alice:p:a:s:s")}`;
    assert.deepEqual(parseBasicAuth(h), { name: "alice", pass: "p:a:s:s" });
  });

  test("scheme is case-insensitive", () => {
    const h = `BASIC ${enc("u:p")}`;
    assert.deepEqual(parseBasicAuth(h), { name: "u", pass: "p" });
  });

  test("missing/empty colon → null", () => {
    assert.equal(parseBasicAuth(`Basic ${enc("nocolon")}`), null);
  });

  test("wrong scheme → null", () => {
    assert.equal(parseBasicAuth(`Bearer ${enc("u:p")}`), null);
  });

  test("malformed inputs → null", () => {
    assert.equal(parseBasicAuth(undefined), null);
    assert.equal(parseBasicAuth(""), null);
    assert.equal(parseBasicAuth("Basic"), null);
    assert.equal(parseBasicAuth("Basic "), null);
    assert.equal(parseBasicAuth(123), null);
  });
});
