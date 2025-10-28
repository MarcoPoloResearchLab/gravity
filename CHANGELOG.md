# Changelog

All notable changes to Gravity Notes live here. Entries follow the [Keep a Changelog](https://keepachangelog.com/) format
and are grouped by the date the work landed on `master`.

## [Unreleased]

### Added
- Change log scaffolding and historical backlog capture (GN-53).
- Python utility `tools/ensure_plan_untracked.py` and a test guard to keep `PLAN.md` untracked (GN-54).
- Local test runs now capture Puppeteer screenshots per suite while skipping CI to aid debugging (GN-70).

### Fixed
- Html view interactions now reserve the chevron toggle for expansion while single clicks anywhere else enter inline edit mode (GN-109).
- Inline editor now wraps selected text with matching backtick fences and escalates when the selection already contains backticks, covering GN-106 with new regression tests.
- Markdown editors re-enable browser grammar hints by wiring spellcheck/autocorrect attributes into EasyMDE inputs, verified by new integration coverage (GN-108).
- Inline editing now completes when clicking card chrome outside the markdown surface, while double-click flows stay in edit mode; covered by a Puppeteer regression (GN-105).
- Note HTML view expansion now persists until manually collapsed, and inline editing preserves the expanded height envelope (GN-71).
- Realtime multi-session regression suite now spies on `EventSource` connections to confirm SSE propagation and unblock GN-83.
- EasyMDE surfaces now honor the same top/left padding as htmlView, and pin toggling finalizes cards after the click handler to keep editing state consistent (GN-82).
- Double-clicking a card now focuses the clicked note and maps to the nearest htmlView text offset using a fallback sampler, backed by a Puppeteer regression (GN-81).
- Snapshot events skip redundant list re-renders, eliminating periodic card flicker and covered by a DOM stability regression (GN-86).
- Card content column now stays level with the controls column and regression coverage watches for misalignment (GN-88).
- Hard refreshes reuse cached backend tokens so sessions survive reloads, with a regression guarding the flow (GN-87).
- Expanded cards on Safari and Firefox no longer render phantom scrollbars; editing height locks now resync to content and new Puppeteer coverage checks expanded-mode growth (GN-103).
- Double-clicking near a note footer no longer collapses the expanded htmlView before entering edit mode; debounce logic preserves expansion and new regression coverage targets the footer region (GN-104).
- Card controls span the full grid height so action buttons anchor to the top-right corner, with a Puppeteer regression guard (GN-84).
- Backend token expiry no longer floods warn logs: realtime SSE disconnects before expiration, expired validations log at info level, and unit tests cover both guards (GN-89).
- Refreshing the app no longer re-triggers Google Sign-In when a session is restored from storage; GIS auto prompt stays disabled until credentials expire (GN-97).
- Double-chevron expand toggle now stays vertically centered on note cards, with Puppeteer coverage guarding the alignment (GN-98).

### Documentation
- Folded `MIGRATION.md` into `ARCHITECTURE.md`, clarifying event contracts and module guidance (GN-54).
- Tightened `NOTES.md` instructions so coding agents only touch `ISSUES.md`, `PLAN.md`, and `CHANGELOG.md` (GN-54).

### Removed
- Deleted the legacy `MIGRATION.md` now that the architecture guide houses the relevant details (GN-54).

### Changed
- Moved the static site, npm tooling, and browser tests under `frontend/` while adjusting Docker and docs to reference the new layout (GN-92).
- Frontend deploy workflow renamed to `frontend-deploy.yml` for naming parity (GN-96).
- Backend CI now runs Go tests on every PR/push to `master`, while Docker images build only after merge (GN-94).
- Frontend CI workflow renamed to `frontend-tests.yml` for naming parity with backend suites (GN-95).
- Puppeteer screenshot artifacts are now controlled via `--screenshots` harness flags with allowlists and async overrides, and README covers the workflow (GN-101).

### Documentation
- Folded `MIGRATION.md` into `ARCHITECTURE.md`, clarifying event contracts, module guidance, and third-party reading expectations (GN-54).
- Tightened `NOTES.md` instructions so coding agents only touch `ISSUES.md`, `PLAN.md`, and `CHANGELOG.md`, including guidance to use `git filter-repo` if `PLAN.md` ever re-enters history (GN-54).

### Removed
- Deleted the legacy `MIGRATION.md` now that the architecture guide houses the relevant details (GN-54).

## 2025-10-20

### Added
- Environment-aware runtime configuration that normalises backend and LLM proxy endpoints from globals, meta tags,
  or inferred origins (GN-50).

### Fixed
- Restored inline card actions while editing so toolbar interactions do not re-open the CodeMirror instance (GN-51).

### Documentation
- Documented the autonomous workflow expectations for the engineering notebook.
- Ensured repository excludes sensitive artefacts and harmonised `.env` usage in Docker settings.

## 2025-10-19

### Fixed
- Repaired bounded HTML view behaviours to keep expanding cards anchored while preserving the grid mask (GN-45).
- Eliminated flicker and cursor resets when clicking already-editing cards and pinned Shift+Enter behaviour to finalise
  edits without reopening HTML views (GN-46, GN-47, GN-48, GN-49).

### Documentation
- Captured architecture evolution and enforced scroll-free card HTML views in both docs and CSS.
- Clarified autonomous contribution flow for Codex agents.

### Testing
- Updated the shared Puppeteer harness to avoid temporary files and stabilise CI execution.

## 2025-10-16

### Added
- Docker-based local development stack pairing the Go backend image with the static frontend host (GN-42).

### Fixed
- Validated persisted authentication credentials before hydrating the UI to close GN-31 snapshot scope bugs (GN-31).

### Changed
- Updated CI to publish backend images from `master` and reference the canonical tag throughout the compose workflow.
- Improved test harness timeout reporting to highlight budget usage (GN-41).

# 2025-10-27

## Fixed
- Preserved in-progress inline edits when sync snapshots re-render notes so typing and paste remain responsive.
- Added regression coverage for the snapshot flow and replaced the external PNG dependency with an in-repo decoder to keep image assertions working during tests.
- Cleared lingering editor height locks after inline edits to avoid blank gutters beneath cards and verified with a Puppeteer regression.
- Centered inline edits and preserved viewport position when bubbling notes so clicking a card no longer snaps it to the top (GN-304).
- Refreshed backend access tokens automatically when synchronization detects expiration, persisted the renewed credentials, and reconnected the realtime stream to keep cross-device notes up to date (GN-303).

## 2025-09-25

### Added
- Keyboard navigation across notes, including the top capture card, with arrow key bindings.
- Note validation pipeline and table-driven tests covering attachments and payload sanitation.
- Delete controls and refreshed glyphs on note cards to align with the action toolbar.
- Clipboard image support with inline placeholders to ensure pasted assets render predictably.

### Fixed
- Prevented focus loops that trapped users in the top editor instead of opening selected cards.
- Clamped pasted image dimensions for consistent HTML views.

## 2025-04-12

### Added
- Initial single-page Markdown editor experience with in-place editing and localStorage persistence.
- Merge and delete flows for notes, plus CNAME hand-off for the production hostname.

### Fixed
- Addressed early regressions around note duplication and ensured client-side storage powers offline usage.
