# Gravity Notes

Gravity Notes is a single-page Markdown notebook designed to keep you in flow. Every idea lives in the same grid, edits happen inline, and the interface never yanks you out of context.

## Highlights

- Inline Markdown editing with a stable layout—no modals or page reloads.
- Bounded HTML previews with fade masks and quick expand controls for longer notes.
- Checklist toggles, code badges, and cover images that surface context automatically.
- Works offline by default and syncs seamlessly when you sign in with Google.
- Full-screen focus mode, expressive keyboard shortcuts, and native spellcheck/grammar support.
- Automatic release detection reloads the app when a new build becomes available.

## Quick Start

1. Open Gravity Notes in your browser (hosted deployment or local build).
2. Capture a new idea in the blank card anchored beneath the header.
3. Click elsewhere or press `Cmd/Ctrl+Enter` to save—Gravity autosaves on blur, so no manual save button is required.
4. Click any rendered card to edit Markdown inline; the caret jumps to the spot you clicked.
5. Use the controls along the right edge to pin, copy, merge, or delete notes without leaving the grid.

## Everyday Workflow

- **Scan effortlessly:** Cards reveal the first paragraphs, the first image, and a code badge when snippets are present. Overflowing notes expose a circular arrow button to expand and collapse without disrupting the grid.
- **Keep lists moving:** Click checklist boxes directly in the rendered view to toggle them. Updates save immediately and bubble the refreshed note to the top.
- **Stay focused:** Toggle the diagonal icon in the header to switch between the regular layout and full-screen workspace.
- **Anchor your context:** Cards never jump during edits, so neighbouring notes remain where you left them.

## Keyboard Shortcuts

- `Enter` — insert a newline inside the editor.
- `Cmd/Ctrl+Enter` or `Cmd/Ctrl+S` — commit the current note.
- `Tab` / `Shift+Tab` — indent or outdent lists and code blocks.
- `Cmd/Ctrl+Shift+K` — delete the current line.
- `Cmd/Ctrl+Shift+D` — duplicate the current line.

## Importing & Sharing

- Open the avatar menu to export your notebook as JSON or import a snapshot. Gravity skips duplicates automatically.
- Use the copy control on each card to grab either Markdown or sanitised HTML for quick sharing.

## Accounts, Sync, and Offline Use

- Sign in with Google from the header to scope the notebook to your account. Each user gets a private storage namespace, so shared devices never mix data.
- Gravity keeps working offline. Notes persist in `localStorage` and sync when connectivity returns or when you sign in.
- Sessions survive refreshes. Sign out from the avatar menu to return to the anonymous notebook.

## Markdown Tips

- Paste or drag images directly into the editor—Gravity inserts attachment placeholders that render in the preview.
- Code blocks receive a `code` badge so technical notes stand out at a glance.
- The EasyMDE editor keeps native spellcheck and grammar suggestions active alongside Markdown tooling.

## Need More?

Developers and curious tinkerers can find project structure, dependencies, and runbooks in the [Architecture & Developer Guide](ARCHITECTURE.md).

## Local Stack (Docker)

Spin up the full stack (frontend, backend, and the new TAuth service) with Docker:

1. `cp backend/env.example backend/.env` and `cp tauth/env.example tauth/.env`, then customize the signing secret, Google Web Client ID, and allowed origins as needed. The defaults keep both services on the same HS256 secret and OAuth client ID. The backend expects:
   - `GRAVITY_TAUTH_SIGNING_SECRET` – shared HS256 secret (matches `APP_JWT_SIGNING_KEY` from TAuth).
   - `GRAVITY_TAUTH_ISSUER` – issuer embedded in the TAuth JWT (defaults to `mprlab-auth`).
   - `GRAVITY_TAUTH_COOKIE_NAME` – cookie carrying the session token (`app_session`).
2. `docker compose -f docker-compose.dev.yml up --build`

The services expose the following host ports:

- Frontend (static assets): `http://localhost:8000`
- Gravity backend API: `http://localhost:8080`
- TAuth (Google Sign-In + session cookies): `http://localhost:8082`

Runtime config files under `frontend/data/` now declare `authBaseUrl`, allowing browser code to discover the active TAuth host in both development and production profiles.
