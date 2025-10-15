import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_ROOT = path.resolve(path.dirname(CURRENT_FILE), "..");

export const RUNTIME_CONTEXT_PATH = path.join(TESTS_ROOT, "runtime-context.json");

let cachedContext = null;

export function readRuntimeContext() {
    if (cachedContext) {
        return cachedContext;
    }
    let raw;
    try {
        raw = fs.readFileSync(RUNTIME_CONTEXT_PATH, "utf8");
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Runtime context unavailable at ${RUNTIME_CONTEXT_PATH}: ${reason}`);
    }
    try {
        cachedContext = JSON.parse(raw);
        return cachedContext;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Runtime context parse failure: ${reason}`);
    }
}
