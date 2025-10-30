import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_ROOT = path.dirname(CURRENT_FILE);
const PROJECT_ROOT = path.join(TESTS_ROOT, "..");
const FRONTEND_JS_ROOT = path.join(PROJECT_ROOT, "js");
const CONSTANTS_PATH = path.join(FRONTEND_JS_ROOT, "constants.js");

async function readAppBuildId() {
    const source = await fs.readFile(CONSTANTS_PATH, "utf8");
    const match = source.match(/APP_BUILD_ID\s*=\s*"([^"]+)"/u);
    if (!match) {
        throw new Error("APP_BUILD_ID is not defined in constants.js.");
    }
    return match[1];
}

async function collectModuleFiles(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const absolute = path.join(root, entry.name);
        if (entry.isDirectory()) {
            const nested = await collectModuleFiles(absolute);
            for (const file of nested) {
                results.push(file);
            }
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".js")) {
            results.push(absolute);
        }
    }
    return results;
}

test("all browser modules include the build query fingerprint in relative imports", async () => {
    const buildId = await readAppBuildId();
    const expectedQuery = `?build=${buildId}`;
    const files = await collectModuleFiles(FRONTEND_JS_ROOT);
    const importPattern = /(import|export)\s+(?:[\s\S]*?from\s+)?["'](\.{1,2}\/[^"']+\.js(?:\?[^"']*)?)["']/gu;

    for (const absolute of files) {
        const source = await fs.readFile(absolute, "utf8");
        const relative = path.relative(PROJECT_ROOT, absolute);
        let match;
        while ((match = importPattern.exec(source)) !== null) {
            const specifier = match[2];
            if (specifier.includes("node:")) {
                continue;
            }
            assert.ok(
                specifier.includes(expectedQuery),
                `Expected ${relative} import \`${specifier}\` to include ${expectedQuery}`
            );
        }
    }
});
