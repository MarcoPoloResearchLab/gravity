# Notes

## Role

You are a staff level full stack engineer. Your task is to **re-evaluate and refactor the Gravity Notes repository** according to the coding standards already written in **AGENTS.md**.  
**Read-only:** Keep operational notes only. Record all issues in `ISSUES.md`. Track changes in the `CHANGELOG.md`

## Context

* AGENTS.md defines all rules: naming, state/event principles, structure, testing, accessibility, performance, and security.
* The repo uses Alpine.js, CDN scripts only, no bundlers.
* Event-scoped architecture: components communicate via `$dispatch`/`$listen`; prefer DOM-scoped events; `Alpine.store` only for true shared domain state.
* The backend uses Go language ecosystem

## Your tasks

1. **Read AGENTS.md first** → treat it as the *authoritative style guide*.
2. **Scan the codebase** → identify violations (inline handlers, globals, duplicated strings, lack of constants, cross-component state leakage, etc.).
3. **Generate PLAN.md** → bullet list of problems and refactors needed, scoped by file. PLAN.md is a part of PR metadata. It's a transient document outlining the work on a given issue. Do not commit PLAN.md; copy its content into the PR description.
4. **Refactor in small commits** →
    Front-end:
    * Inline → Alpine `x-on:`
    * Buttons → standardized Alpine factories/events
    * Notifications → event-scoped listeners (DOM-scoped preferred)
    * Strings → move to `constants.js`
    * Utilities → extract into `/js/utils/`
    * Composition → normalize `/js/app.js` as Alpine composition root
    Backend:
    * Use "object-oreinted" stye of functions attached to structs
    * Prioritize data-driven solutions over imperative approach
    * Design and use shared components
5. **Tests** → Add/adjust Puppeteer tests for key flows (button → event → notification; cross-panel isolation). Prioritize end-2-end and integration tests.
6. **Docs** → Update README and CHANGELOG.md with new event contracts, removed globals, and developer instructions.
7. **Timeouts** Prepend every CLI command with `timeout -k <N>s -s SIGKILL <N>s <command>`. This is mandatory for all commands (local dev, CI, docs, scripts). Pick `<N>` appropriate to the operation; avoid indefinite waits. The Node test harness enforces per-test budgets but the shell-level timeout remains required.

## Output requirements

* Always follow AGENTS.md rules (do not restate them, do not invent new ones).
* Output a **PLAN.md** first, then refactor step-by-step.
* Only modify necessary files.
* Treat `NOTES.md` as read-only; never edit it during an implementation cycle.
* Only touch the following markdown files while delivering work: `ISSUES.md` (append-only status log), `PLAN.md` (local, untracked scratchpad), and `CHANGELOG.md` (post-completion history).
* If `PLAN.md` becomes tracked, remove it from history with `git filter-repo --path PLAN.md --invert-paths` before continuing.
* Descriptive identifiers, no single-letter names.
* End with a short summary of changed files and new event contracts.

**Begin by reading AGENTS.md and generating PLAN.md now.**

## Rules of engagement

Review the NOTES.md. Make a plan for autonomously fixing every item under Features, BugFixes, Improvements, Maintenance. Ensure no regressions. Ensure adding tests. Lean into integration tests. Fix every issue. Document the changes.

Fix issues one by one, working sequentially. 
1. The production git branch is called `master`. The `main` branch does not exist.
2. Create a new git bracnh with descriptive name, for example `feature/LA-56-widget-defer` or `bugfix/LA-11-alpine-rehydration`. Use the taxonomy of issues as prefixes: improvement/, feature/, bugfix/, maintenace/, issue ID and a short descriptive. Respect the name limits.
3. Describe an issue through tests. 
3a. Ensure that the tests are comprehensive and failing to begin with. 
3b. Ensure AGENTS.md coding standards are checked and test names/descriptions reflect those rules.
4. Fix the issue
5. Rerun the tests
6. Repeat pp 2-4 untill the issue is fixed: 
6a. old and new comprehensive tests are passing
6b. Confirm black-box contract aligns with event-driven architecture (frontend) or data-driven logic (backend).
6c. If an issue can not be resolved after 3 carefull iterations, 
    - mark the issue as [Blocked].
    - document the reason for the bockage.
    - commit the changes into a separate branch called "blocked/<issue-id>".
    - work on the next issue from the divergence point of the previous issue.
7. Write a nice comprehensive commit message AFTER EACH issue is fixed and tested and covered with tests.
8. Optional: update the README in case the changes warrant updated documentation (e.g. have user-facing consequences)
9. Optional: ipdate the PRD in case the changes warrant updated product requirements (e.g. change product undestanding)
10. Optional: update the code examples in case the changes warrant updated code examples
11. Mark an issue as done ([X])in the NOTES.md after the issue is fixed: New and existing tests are passing without regressions
12. Commit and push the changes to the remote branch.
13. Repeat till all issues are fixed, and commits abd branches are stacked up (one starts from another).

Do not work on all issues at once. Work at one issue at a time sequntially.

Working with git bracnhes you are forbidden from using --force and rebase operations. Only merges and sequential progression of changes.

Leave Features, BugFixes, Improvements, Maintenance sections empty when all fixes are implemented but don't delete the sections themselves.

## Issue Tracking

All feature, improvement, bugfix, and maintenance backlog entries now live in `ISSUES.md`. This file remains append-only for process notes.

*Use `PLAN.md` (ignored by git) as a scratchpad for the single active issue; do not commit it.*

## Completed

- [x] 2025-10-21 — GN-52 collapsed the LLM proxy configuration to a single `llmProxyUrl` endpoint with updated docs and tests.
- [x] 2025-10-21 — GN-53 runtime config now loads from hostname-scoped JSON, replacing `window.GRAVITY_CONFIG` overrides.
