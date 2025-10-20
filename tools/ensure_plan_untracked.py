#!/usr/bin/env python3
"""
Utility to enforce that PLAN.md remains untracked.

The script exits with status 0 when PLAN.md is absent from the git index.
If the file is tracked or staged, the script emits a diagnostic message and
returns a non-zero status so automated checks can fail fast.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PLAN_PATH = REPO_ROOT / "PLAN.md"


def run_git_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def plan_is_tracked() -> bool:
    tracked = run_git_command(["ls-files", "--error-unmatch", str(PLAN_PATH.name)])
    return tracked.returncode == 0


def staged_status_codes() -> set[str]:
    staged = run_git_command(
        ["diff", "--cached", "--name-status", "--", str(PLAN_PATH.name)]
    )
    statuses: set[str] = set()
    for line in staged.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        status = parts[0]
        statuses.add(status)
    return statuses


def main() -> int:
    tracked = plan_is_tracked()
    staged = staged_status_codes()

    if tracked:
        sys.stderr.write(
            "PLAN.md is tracked in git; remove it with "
            "`git rm --cached PLAN.md` and ensure it stays ignored.\n"
        )
        return 1

    invalid_statuses = staged.difference({"D"})
    if invalid_statuses:
        sys.stderr.write(
            "PLAN.md has staged changes; ensure it remains untracked before committing.\n"
        )
        return 2

    if "D" in staged:
        # Deleting PLAN.md from history is expected; allow the staged removal.
        return 0

    if not PLAN_PATH.exists():
        sys.stderr.write(
            "PLAN.md is missing from the working tree; create the planning scratchpad "
            "if the process requires it.\n"
        )
        return 3

    return 0


if __name__ == "__main__":
    sys.exit(main())
