import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { harnessDefaults, runTestProcess } from "../helpers/testHarness.js";
import { RUNTIME_CONTEXT_PATH } from "../helpers/runtimeContext.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_DIRECTORY = path.resolve(path.dirname(CURRENT_FILE), "..");
const HARNESS_SCRIPT = path.join(TESTS_DIRECTORY, "run-tests.js");
const RUNTIME_OPTIONS_PATH = path.join(TESTS_DIRECTORY, "runtime-options.json");
const FIXTURES_DIRECTORY = path.join(TESTS_DIRECTORY, "harness", "fixtures");

function stripAnsi(value) {
    return value.replace(/\u001B\[[0-9;]*m/g, "");
}

async function readContextSnapshot() {
    try {
        return await fs.readFile(RUNTIME_CONTEXT_PATH, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function restoreContextSnapshot(snapshot) {
    if (snapshot === null) {
        await fs.rm(RUNTIME_CONTEXT_PATH, { force: true }).catch(() => {});
        return;
    }
    await fs.writeFile(RUNTIME_CONTEXT_PATH, snapshot, "utf8").catch(() => {});
}

async function runHarnessWithOptions(options) {
    await fs.writeFile(RUNTIME_OPTIONS_PATH, JSON.stringify(options), "utf8");
    try {
        return await runTestProcess({
            command: process.execPath,
            args: [HARNESS_SCRIPT],
            timeoutMs: 8000
        });
    } finally {
        await fs.rm(RUNTIME_OPTIONS_PATH, { force: true }).catch(() => {});
    }
}

async function ensureFixturesDirectory() {
    await fs.mkdir(FIXTURES_DIRECTORY, { recursive: true });
}

async function removeFixture(fixturePath) {
    await fs.rm(fixturePath, { force: true }).catch(() => {});
}

test("run-tests harness reports summary for passing suites", async () => {
    const snapshot = await readContextSnapshot();
    try {
        const result = await runHarnessWithOptions({
            // exact filename — no regex
            pattern: "helpers/testHarness.test.js",
            timeoutMs: 3000
        });
        assert.equal(result.exitCode, 0);
        const plain = stripAnsi(result.stdout);
        assert.match(plain, /Totals/u);
        assert.match(plain, /helpers\/testHarness\.test\.js/u);
    } finally {
        await restoreContextSnapshot(snapshot);
    }
});

test("run-tests harness surfaces timeouts in summary", async () => {
    await ensureFixturesDirectory();
    const fixtureRelative = "harness/fixtures/timeout.fixture.test.js";
    const fixturePath = path.join(TESTS_DIRECTORY, fixtureRelative);
    await fs.writeFile(
      fixturePath,
      [
        "import test from 'node:test';",
        "test('hung fixture', async () => {",
        "  await new Promise(() => {});",
        "});"
      ].join("\n"),
      "utf8"
    );

    const snapshot = await readContextSnapshot();
    try {
        // exact filename — no regex
        const result = await runHarnessWithOptions({
            pattern: fixtureRelative,
            timeoutOverrides: { [fixtureRelative]: 50 },
            killOverrides: { [fixtureRelative]: 50 }
        });

        const plain = stripAnsi(result.stdout);

        // Must exit non-zero on timeout
        assert.notEqual(
            result.exitCode,
            0,
            `harness should surface timeout failures\nSTDOUT:\n${plain}\nSTDERR:\n${result.stderr}`
        );

        // Summary must mention the file and 'timeout'
        const escaped = fixtureRelative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.match(plain, new RegExp(escaped, "u"), "summary lists the fixture");
        assert.match(plain, /timeout/u, "summary mentions timeout");

        // Termination reason should be one of the harness failure reasons
        const allowed = new Set([
            harnessDefaults.terminationReason.exit,
            harnessDefaults.terminationReason.timeout
        ]);
        assert.ok(
            allowed.has(result.terminationReason),
            `unexpected terminationReason: ${String(result.terminationReason)}`
        );
    } finally {
        await restoreContextSnapshot(snapshot);
        await removeFixture(fixturePath);
    }
});
