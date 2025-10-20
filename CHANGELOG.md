# Changelog

All notable changes to Gravity Notes live here. Entries follow the [Keep a Changelog](https://keepachangelog.com/) format
and are grouped by the date the work landed on `master`.

## [Unreleased]

### Added
- Change log scaffolding and historical backlog capture (GN-53).

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
- Repaired bounded preview behaviours to keep expanding cards anchored while preserving the grid mask (GN-45).
- Eliminated flicker and cursor resets when clicking already-editing cards and pinned Shift+Enter behaviour to finalise
  edits without reopening previews (GN-46, GN-47, GN-48, GN-49).

### Documentation
- Captured architecture evolution and enforced scroll-free card previews in both docs and CSS.
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

## 2025-09-25

### Added
- Keyboard navigation across notes, including the top capture card, with arrow key bindings.
- Note validation pipeline and table-driven tests covering attachments and payload sanitation.
- Delete controls and refreshed glyphs on note cards to align with the action toolbar.
- Clipboard image support with inline placeholders to ensure pasted assets render predictably.

### Fixed
- Prevented focus loops that trapped users in the top editor instead of opening selected cards.
- Clamped pasted image dimensions for consistent previews.

## 2025-04-12

### Added
- Initial single-page Markdown editor experience with in-place editing and localStorage persistence.
- Merge and delete flows for notes, plus CNAME hand-off for the production hostname.

### Fixed
- Addressed early regressions around note duplication and ensured client-side storage powers offline usage.
