// @ts-check

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(CURRENT_FILE), "..");
const GUARD_SCRIPT = path.join(REPO_ROOT, "tools", "ensure_plan_untracked.py");

test("PLAN.md remains untracked and available locally", () => {
  const result = spawnSync("python3", [GUARD_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, PYTHONUNBUFFERED: "1" }
  });

  const diagnostics = [
    result.stdout?.trim() ?? "",
    result.stderr?.trim() ?? ""
  ]
    .filter(Boolean)
    .join("\n");

  assert.equal(
    result.status,
    0,
    diagnostics === "" ? "ensure_plan_untracked.py reported a failure" : diagnostics
  );
});
