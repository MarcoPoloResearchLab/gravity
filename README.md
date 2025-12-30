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

## Local Stack (Gravity + TAuth)

Run the full application locally (frontend, backend, and the new TAuth service) via Docker:

1. Copy the environment files and customize secrets as needed:
   - `cp .env.gravity.example .env.gravity`
   - `cp .env.tauth.example .env.tauth`

   Keep `GRAVITY_TAUTH_SIGNING_SECRET` in sync with `APP_JWT_SIGNING_KEY` so Gravity and TAuth agree on JWT signatures.

2. Start the stack with the development profile (local backend build): `docker compose --profile dev up --build`

   Switch to the docker profile (`docker compose --profile docker up`) to run everything from prebuilt GHCR images.

The compose file exposes:

- Frontend static assets at `http://localhost:8000`
- Gravity backend API at `http://localhost:8080`
- TAuth (nonce + Google exchange + `tauth.js`) at `http://localhost:8082`

Runtime configuration files under `frontend/data/` now include `authBaseUrl`, so the browser can discover which TAuth origin to contact for `/auth/nonce`, `/auth/google`, and `/auth/logout` once the frontend wiring lands. Update `frontend/data/runtime.config.production.json` if your deployment uses a different TAuth hostname.

### Authentication Contract

- Gravity no longer exchanges Google credentials itself. The browser loads `https://<tauth-origin>/tauth.js`, fetches a nonce from `/auth/nonce`, and lets TAuth exchange the Google credential at `/auth/google`.
- TAuth mints two cookies: `app_session` (short-lived HS256 JWT) and `app_refresh` (long-lived refresh token). Every request from the UI includes `app_session` automatically, so the Gravity backend simply validates the JWT using `GRAVITY_TAUTH_SIGNING_SECRET` / `GRAVITY_TAUTH_ISSUER`. No bearer tokens or local storage is used.
- To keep the multi-tenant TAuth flow working, the backend’s CORS preflight now whitelists the `X-TAuth-Tenant` header (in addition to `Authorization`, `Content-Type`, etc.), so browsers can send the tenant hint while relying on cookie authentication.
- When a request returns `401`, the browser calls `/auth/refresh` on the TAuth origin; a fresh `app_session` cookie is minted and the original request is retried.
- Signing out in the UI calls `/auth/logout`, revokes the refresh token, clears both cookies, and returns Gravity to the anonymous notebook.
- The backend maintains its own canonical user table (`user_identities`) so every identity provider subject (e.g., `google:1234567890`) maps to the same Gravity user id. That gives us flexibility to add Apple/email logins later without touching the notes schema.
