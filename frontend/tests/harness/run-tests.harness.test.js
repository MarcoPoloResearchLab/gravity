import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { harnessDefaults, runTestProcess } from "../helpers/testHarness.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_DIRECTORY = path.resolve(path.dirname(CURRENT_FILE), "..");
const HARNESS_SCRIPT = path.join(TESTS_DIRECTORY, "run-tests.js");
const RUNTIME_OPTIONS_PATH = path.join(TESTS_DIRECTORY, "runtime-options.json");
const FIXTURES_DIR = path.join(TESTS_DIRECTORY, "harness", "fixtures");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

async function runHarnessWithOptions(options) {
  await fs.writeFile(RUNTIME_OPTIONS_PATH, JSON.stringify(options), "utf8");
  try {
    return await runTestProcess({
      command: process.execPath,
      args: [HARNESS_SCRIPT],
      timeoutMs: 10000,
      env: { NO_COLOR: "1" }
    });
  } finally {
    await fs.rm(RUNTIME_OPTIONS_PATH, { force: true }).catch(() => {});
  }
}

async function ensureFixtures() {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  // Passing test file (node:test)
  await fs.writeFile(
    path.join(FIXTURES_DIR, "passing.fixture.test.js"),
    [
      "// @ts-check",
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('trivial pass', () => {",
      "  assert.equal(1 + 1, 2);",
      "});"
    ].join("\n"),
    "utf8"
  );
  // Raw hanging script (no node:test) — the harness timeout is authoritative
  await fs.writeFile(
    path.join(FIXTURES_DIR, "timeout.fixture.hang.js"),
    [
      "// @ts-check",
      "import net from 'node:net';",
      "// Deterministic hang: open a server and keep an interval so the event loop stays alive.",
      "const server = net.createServer(() => {});",
      "server.listen(0, '127.0.0.1');",
      "setInterval(() => {}, 10000);"
    ].join("\n"),
    "utf8"
  );
}

async function cleanupFixtures() {
  await fs.rm(FIXTURES_DIR, { recursive: true, force: true }).catch(() => {});
}

test("run-tests harness reports summary for passing suites", async () => {
  await ensureFixtures();
  try {
    const passingRelative = "harness/fixtures/passing.fixture.test.js";
    const result = await runHarnessWithOptions({
      minimal: true,
      explicitFiles: [passingRelative],
      timeoutMs: 3000
    });

    assert.equal(result.exitCode, harnessDefaults.exitCode.success);
    const plain = stripAnsi(result.stdout);
    assert.match(plain, /Summary/u);
    assert.match(plain, new RegExp(escapeRegExp(passingRelative), "u"));
    assert.doesNotMatch(plain, /\btimeout\b/i);
  } finally {
    await cleanupFixtures();
  }
});

test("run-tests harness surfaces timeouts in summary", async () => {
  await ensureFixtures();
  try {
    const hangRelative = "harness/fixtures/timeout.fixture.hang.js";
    const result = await runHarnessWithOptions({
      minimal: true,
      raw: true, // run as plain Node script so harness timeout is authoritative
      explicitFiles: [hangRelative],
      timeoutOverrides: { [hangRelative]: 250 },
      killOverrides: { [hangRelative]: 100 }
    });

    assert.equal(
      result.exitCode,
      harnessDefaults.exitCode.timeout,
      "harness should surface timeout failures"
    );

    const plain = stripAnsi(result.stdout);
    assert.match(plain, new RegExp(escapeRegExp(hangRelative), "u"), "summary lists the fixture");
    assert.match(plain, /\btimeout\b/i, "summary mentions timeout");

    assert.equal(
      result.terminationReason,
      harnessDefaults.terminationReason.timeout,
      `unexpected terminationReason: ${String(result.terminationReason)}`
    );
  } finally {
    await cleanupFixtures();
  }
});
