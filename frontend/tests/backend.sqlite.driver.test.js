import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const GO_MOD_PATH = path.join(PROJECT_ROOT, "backend", "go.mod");

test("backend uses CGO-free sqlite driver", async () => {
    const goModContents = await fs.readFile(GO_MOD_PATH, "utf8");
    assert.ok(
        goModContents.includes("github.com/glebarez/sqlite"),
        "backend go.mod must depend on github.com/glebarez/sqlite"
    );
    assert.ok(
        !goModContents.includes("gorm.io/driver/sqlite"),
        "backend must not reference gorm.io/driver/sqlite (CGO-enabled)"
    );
    assert.ok(
        !goModContents.includes("github.com/mattn/go-sqlite3"),
        "backend must not depend on github.com/mattn/go-sqlite3 (CGO-enabled)"
    );
});
