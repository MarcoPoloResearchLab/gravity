import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

test("backend Docker packaging artifacts exist", async () => {
    const dockerfilePath = path.join(PROJECT_ROOT, "backend", "Dockerfile");
    const composePath = path.join(PROJECT_ROOT, "docker-compose.yml");

    const [hasDockerfile, hasCompose] = await Promise.all([
        fileExists(dockerfilePath),
        fileExists(composePath)
    ]);

    assert.equal(hasDockerfile, true, "backend/Dockerfile is required for container builds");
    assert.equal(hasCompose, true, "docker-compose.yml is required for local container orchestration");
});
