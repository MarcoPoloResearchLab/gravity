// GN-31 session persistence follow-up
- [x] NOTES.md — add the open GN-31 follow-up entry so work remains tracked.
- [x] js/app.js — drop deferred auth-event queueing, and ensure session restore validates credentials before touching user scope.
- [x] tests/helpers/syncTestUtils.js — remove the ATTRIBUTE_APP_READY dependency and allow pre-navigation hooks for stubbing.
- [x] tests/auth.sessionPersistence.puppeteer.test.js — run in a sandboxed browser with stubbed backend endpoints to validate reload persistence offline.
- [x] js/constants.js — prune unused ATTRIBUTE_APP_READY export after consumers migrate.
