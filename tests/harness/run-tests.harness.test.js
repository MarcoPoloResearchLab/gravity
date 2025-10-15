import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import test from "node:test";

import { harnessDefaults, runTestProcess } from "../helpers/testHarness.js";
import { RUNTIME_CONTEXT_PATH } from "../helpers/runtimeContext.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_DIRECTORY = path.resolve(path.dirname(CURRENT_FILE), "..");
const HARNESS_SCRIPT = path.join(TESTS_DIRECTORY, "run-tests.js");
const RUNTIME_OPTIONS_PATH = path.join(TESTS_DIRECTORY, "runtime-options.json");
const FIXTURES_DIRECTORY = path.join(TESTS_DIRECTORY, "harness", "fixtures");

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAnsi(value) {
    return value.replace(/\u001B\[[0-9;]*m/g, "");
}

async function snapshotRuntimeContext() {
    try {
        return await fs.readFile(RUNTIME_CONTEXT_PATH, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function restoreRuntimeContext(snapshot) {
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

test("run-tests harness scenarios", async (t) => {
    await fs.mkdir(FIXTURES_DIRECTORY, { recursive: true });

    const scenarios = [
        {
            name: "reports summaries for filtered passing suites",
            async run() {
                const result = await runHarnessWithOptions({
                    pattern: "^helpers/testHarness\\.test\\.js$",
                    timeoutMs: 3000
                });
                assert.equal(result.exitCode, 0);
                const output = stripAnsi(result.stdout);
                assert.match(output, /Totals/u);
                assert.match(output, /helpers\/testHarness\.test\.js/u);
            }
        },
        {
            name: "surfaces timeouts for hung suites",
            async run() {
                const fixtureName = `timeout.fixture.${crypto.randomUUID()}.test.js`;
                const fixtureRelative = path.join("harness", "fixtures", fixtureName);
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

                try {
                    const timeoutPattern = `^${escapeRegExp(fixtureRelative)}$`;
                    const result = await runHarnessWithOptions({
                        pattern: timeoutPattern,
                        timeoutOverrides: {
                            [fixtureRelative]: 50
                        },
                        killOverrides: {
                            [fixtureRelative]: 50
                        }
                    });
                    assert.notEqual(result.exitCode, 0, "harness should report timeout failures");
                    const output = stripAnsi(result.stdout);
                    assert.match(output, new RegExp(`⏱\\s+${escapeRegExp(fixtureRelative)}`));
                    assert.match(output, /timeout/u);
                    assert.equal(result.terminationReason, harnessDefaults.terminationReason.exit);
                } finally {
                    await fs.rm(fixturePath, { force: true }).catch(() => {});
                }
            }
        }
    ];

    for (const scenario of scenarios) {
        await t.test(scenario.name, async () => {
            const snapshot = await snapshotRuntimeContext();
            try {
                await scenario.run();
            } finally {
                await restoreRuntimeContext(snapshot);
            }
        });
    }
});
