// GN-31 session persistence validation
- [x] js/app.js — only restore persisted auth after validating credential payload and successful backend exchange; ensure stale state is purged before stores initialize.
- [x] js/core/authState.js — add exported validator that checks credential audience, issuer, and subject alignment with persisted user details.
- [x] tests/auth.sessionPersistence.offline.puppeteer.test.js — add regression coverage that exercises reload persistence with a stubbed backend exchange instead of the shared harness.
- [x] tests/helpers/syncTestUtils.js — support injecting stubbed backend responses for offline persistence coverage.

// GN-42 developer docker stack
- [ ] docker-compose.yml — define frontend service using temirov/ghttp, share local sources, and load backend environment file.
- [ ] Dockerfile.frontend — build a static image on top of temirov/ghttp that bakes in repository assets for CI publishing.
- [ ] .github/workflows/frontend-docker.yml — publish the frontend image to GHCR on main pushes and manual dispatch.
- [ ] README.md — document docker compose workflow for running the full stack locally.
