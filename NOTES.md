# Notes

### Role

You are a senior front-end engineer. Your task is to **re-evaluate and refactor the repository Gravity Notes** according to the coding standards already written in **AGENTS.md**.

### Context

* AGENTS.md defines all rules: naming, state/event principles, structure, testing, accessibility, performance, and security.
* The repo uses Alpine.js, CDN scripts only, no bundlers.
* Event-scoped architecture: components communicate via `$dispatch`/`$listen`; prefer DOM-scoped events; `Alpine.store` only for true shared domain state.

### Your tasks

1. **Read AGENTS.md first** → treat it as the *authoritative style guide*.
2. **Scan the codebase** → identify violations (inline handlers, globals, duplicated strings, lack of constants, cross-component state leakage, etc.).
3. **Generate PLAN.md** → bullet list of problems and refactors needed, scoped by file.
4. **Refactor in small commits** →

   * Inline → Alpine `x-on:`
   * Buttons → standardized Alpine factories/events
   * Notifications → event-scoped listeners (DOM-scoped preferred)
   * Strings → move to `constants.js`
   * Utilities → extract into `/js/utils/`
   * Composition → normalize `/js/app.js` as Alpine composition root
5. **Tests** → Add/adjust Puppeteer tests for key flows (button → event → notification; cross-panel isolation).
6. **Docs** → Update README and MIGRATION.md with new event contracts, removed globals, and developer instructions.

### Output requirements

* Always follow AGENTS.md rules (do not restate them, do not invent new ones).
* Output a **PLAN.md** first, then refactor step-by-step.
* Only modify necessary files.
* Descriptive identifiers, no single-letter names.
* End with a short summary of changed files and new event contracts.

**Begin by reading AGENTS.md and generating PLAN.md now.**

## Rules of engagement

Review the NOTES.md. Make a plan for autonomously fixing every item under Features, BugFixes, Improvements, Maintenance. Ensure no regressions. Ensure adding tests. Lean into integration tests. Fix every issue. Document the changes.

Fix issues one by one. 
1. Create a new git branch with descriptive name
2. Describe an issue through tests. Ensure that the tests are comprehensive and failing to begin with.
3. Fix the issue
4. Rerun the tests
5. Repeat 2-4 untill the issue is fixed and comprehensive tests are passing
6. Write a nice comprehensive commit message AFTER EACH issue is fixed and tested and covered with tests.
7. Optional: update the README in case the changes warrant updated documentation
8. Optional: ipdate the PRD in case the changes warrant updated product requirements
9. Optional: update the code examples in case the changes warrant updated code examples
10. Mark an issue as done ([X])in the NOTES.md after the issue is fixed: New and existing tests are passing without regressions
11. Commit the changes and push to the remote.

Do not work on all issues at once. Work at one issue at a time sequntially.

Leave Features, BugFixes, Improvements, Maintenance sections empty when all fixes are implemented but don't delete the sections themselves.

## Features

- [x] [GN-11] Add logging using Google Login SDK (frontend only). Employ sthe GSI approach you can find in the countodwn folder [text](countdown/app.js). use Google Client ID "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com"
- [x] [GN-12] Associate local storage where we store all notes with the user (see [GN-11]). A good test would be to confirm that thwo users logged in in the same browser will not see each other notes.

## Improvements

- [GN-10] When the note is exapnded in rendering mode do not move the viewpoint to its end. Leave the note staying as is and just exand it to full rendering

## BugFixes

## Maintenance
