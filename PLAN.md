// Outstanding refactors and fixes
- [x] tests/helpers/testHarness.js — surface harness timeout semantics through exit codes and termination reason mapping so callers can distinguish timeout failures (GN-41).
- [x] tests/run-tests.js — emit dedicated timeout exit code when any suite times out and ensure summary bookkeeping stays authoritative (GN-41).
- [x] tests/harness/run-tests.harness.test.js — extend coverage for timeout exit codes and termination reason plumbing (GN-41).
- [x] NOTES.md — mark GN-41 complete after harness timeout handling is verified (GN-41).
