# Changelog

All notable changes to Gravity Notes live here. Entries follow the [Keep a Changelog](https://keepachangelog.com/) format
and are grouped by the date the work landed on `master`.

## [Unreleased]

### Added
- Change log scaffolding and historical backlog capture (GN-53).
- Python utility `tools/ensure_plan_untracked.py` and a test guard to keep `PLAN.md` untracked (GN-54).
- Local test runs now capture Puppeteer screenshots per suite while skipping CI to aid debugging (GN-70).
- Header includes a diagonal full-screen toggle with stateful icons and dedicated regression coverage (GN-204).
- Background version watcher polls a manifest and reloads the app when a new deploy ships so browsers never run stale code (GN-206).

### Changed
- Frontend persistence now uses IndexedDB with a localStorage migration and BroadcastChannel refreshes (GN-439).
- Full-screen toggle now lives inside the avatar menu with updated exit icon strokes and a text label (GN-207).
- Auth header now shows only the signed-in display name to avoid exposing email addresses (GN-208).
- TAuth session now delegates nonce issuance and credential exchange to auth-client helpers instead of local fetches (GN-423).
- Centralized environment config defaults and reused them across runtime config and test harnesses (GN-427).
- Runtime config now returns a frozen app config and callers pass it explicitly instead of shared globals (GN-427).
- Environment example files now live at `env.*.example`, keeping `.env*` files untracked while preserving copy-ready templates (GN-443).
- mpr-ui now loads from a runtime-configured script URL (`mprUiScriptUrl`) after tauth.js so login components always register (GN-444).
- Auth boot now fails fast when required helpers/components are missing and pre-initializes Google Identity Services before rendering the login button to avoid GSI warnings (GN-445).
- Signed-out visitors now see a landing page with a Google sign-in button; the Gravity interface requires authentication (GN-126).
- mpr-ui now loads from a static script tag and auth components mount after runtime config so attributes are applied before initialization (GN-436).
- Frontend now pulls mpr-ui assets from the `@latest` CDN tag so releases stay aligned (GN-437).

### Fixed
- CRDT snapshot coverage now bounds snapshot_update_id to cursor history and refreshes queued snapshot update ids so remote updates are never skipped (GN-457).
- Sync now requires a client base version for each operation, rejecting stale updates while treating duplicate payloads as no-op acceptances to preserve newer history (GN-453).
- TAuth helper now loads from a dedicated CDN URL via `tauthScriptUrl`, and gHTTP no longer proxies `/tauth.js` while proxying `/me` to TAuth for session checks in the dev stack (GN-442).
- Dev docker compose now serves Gravity over HTTPS at computercat.tyemirov.net:4443 via gHTTP proxies for backend/TAuth endpoints, with updated dev runtime config and env templates (GN-441).
- Normalized development runtime config endpoints to swap loopback hosts for the active dev hostname and refreshed the TAuth env example for localhost defaults (GN-440).
- Sync queue now coalesces per note and resolves payloads from the latest stored note to avoid duplicate ops and offline failures (GN-439).
- Landing sign-in now sets mpr-ui auth base/login/logout/nonce attributes so nonce requests hit TAuth instead of the frontend origin (GN-433).
- Runtime config now accepts a Google client ID override so local GSI origins can match the correct project (GN-438).
- Updated the TAuth helper loader and harness to use `/tauth.js`, keeping Gravity aligned with current TAuth builds (GN-424).
- Expanded edit-height locks now override CodeMirror auto sizing so expanded cards keep their height in edit mode (GN-425).
- TAuth runtime config now forwards `authTenantId` into the loader/session bridge and drops the crossOrigin attribute so tauth.js loads cleanly in stricter CORS setups (GN-426).
- Spellcheck replacement regression coverage now simulates replacement input events instead of `execCommand` to avoid flakes (GN-427).
- Hardened sync payload validation to require noteId + markdownText, enforce note id matching, and rollback on audit/id failures (GN-427).
- Sync deletes now treat JSON null payloads as empty so delete operations are not rejected during validation (GN-431).
- Backend 401 responses now trigger a frontend sign-out so invalid sessions cannot keep the UI authenticated; sync integration tests attach backend cookies before sign-in (GN-428).
- Conflict-aware LWW sync now preserves local edits on rejected operations, tracks conflicts, and avoids overwriting local changes during snapshots (GN-429).
- Html view interactions now reserve the chevron toggle for expansion while single clicks anywhere else enter inline edit mode (GN-109).
- Inline editor now wraps selected text with matching backtick fences and escalates when the selection already contains backticks, covering GN-106 with new regression tests.
- Markdown editors re-enable browser grammar hints by wiring spellcheck/autocorrect attributes into EasyMDE inputs, verified by new integration coverage (GN-108).
- Markdown editor now uses a contenteditable surface so native browser grammar and spellcheck tooling works again, covered by a Puppeteer regression (GN-205).
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
- Checkbox toggles triggered during htmlView bubbling no longer spawn duplicate note cards; bubbling now resolves to the live DOM node and a Safari-focused regression locks the behavior (GN-306).
- Expand/collapse toggles now align to the full card width rather than the text column, with resize-aware positioning and mobile regression coverage (GN-307).
- Clicking the card control column now finalizes inline editing without flickering back to markdown mode, covered by a regression targeting the GN-308 scenario (GN-308).
- Puppeteer sync persistence tests now ensure backend session cookies attach (with a request-interceptor fallback for file:// origins), stabilizing multi-iteration runs (GN-432).
- Sync end-to-end coverage now waits for the authenticated shell and CodeMirror input before typing to avoid focus races (GN-434).
- Expanded htmlView checkbox toggles now preserve viewport anchors and skip redundant re-renders to prevent drift (GN-435).
- Runtime config now requires an explicit Google client ID so GIS matches the configured origin and the landing sign-in button renders (GN-438).

### Documentation
- Folded `MIGRATION.md` into `ARCHITECTURE.md`, clarifying event contracts and module guidance (GN-54).
- Tightened `NOTES.md` instructions so coding agents only touch `ISSUES.md`, `PLAN.md`, and `CHANGELOG.md` (GN-54).
- Reworked `README.md` to focus on user-facing workflows and migrated technical setup guidance into `ARCHITECTURE.md` (GN-400).
- Documented the full-screen controller, keyboard shortcuts modal, analytics bootstrap, and version refresh utility in `ARCHITECTURE.md` so the guide matches the current code structure (GN-401).
- Added `REFACTORING_PLAN.md` capturing backend smart constructor work, frontend card-controller decomposition, and testing upgrades required by POLICY.md (GN-402).
- Added a CRDT/OT sync evaluation with merge strategy, payload schema, and migration plan (GN-454).

### Removed
- Deleted the legacy `MIGRATION.md` now that the architecture guide houses the relevant details (GN-54).

### Changed
- Moved the static site, npm tooling, and browser tests under `frontend/` while adjusting Docker and docs to reference the new layout (GN-92).
- Frontend deploy workflow renamed to `frontend-deploy.yml` for naming parity (GN-96).
- Backend CI now runs Go tests on every PR/push to `master`, while Docker images build only after merge (GN-94).
- Frontend CI workflow renamed to `frontend-tests.yml` for naming parity with backend suites (GN-95).
- Puppeteer screenshot artifacts are now controlled via `--screenshots` harness flags with allowlists and async overrides, and README covers the workflow (GN-101).
- HTML view expand toggle now uses a circular arrow icon that rotates to indicate collapse state (GN-200).
- Expanded the htmlView expand toggle hit area so the entire bottom strip responds to clicks (GN-201).
- Unified double-click and tap gestures with single clicks when entering or leaving inline edit mode (GN-202).
- Reflowed card controls above note content on narrow viewports to improve mobile ergonomics (GN-203).
- Cache-busting reloads append the manifest build to asset URLs and clear Cache Storage before navigating so stale bundles do not linger after deploys (GN-206).

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
- Concealed browser-native scrollbars by hiding the root scrollbar pseudo element while keeping the feed scrollable, enforced with a regression test (GN-305).
- Hardened the inline editor anchoring and htmlView expansion Puppeteer tests to eliminate intermittent flakiness under randomized multi-iteration runs (GN-209).

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
