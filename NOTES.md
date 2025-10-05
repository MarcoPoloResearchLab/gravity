# Notes

## Rules of engagement

Review the notes.md. make a plan for autonomously fixing every bug. ensure no regressions. ensure adding tests. lean into integration tests. fix every bug.

Fix bugs one by one. Write a nice comprehensive commit message AFTER EACH bug is fixed and tested and covered with tests. Remove the bug from the notes.md. commit and push to the remote.

Leave Bugfix section empty but dont delete the section itself.

## Bugfix



### Tests

Tests are failing. The UI looks fine, so look into both the code and the tests to understand the root cause before fixing

13:55:48 tyemirov@Vadyms-MacBook-Pro:~/Development/gravity - [editor-fix] $ npm test

> test
> node --test

✔ clipboard plain text scenarios (1.333116ms)
▶ Enhanced Markdown editor
  ✔ EasyMDE auto-continues lists, fences, and brackets (1365.330407ms)
✔ Enhanced Markdown editor (2821.133473ms)
▶ Markdown inline editor
  ✔ click-to-edit auto-grows and saves inline (1423.115945ms)
  ✔ second click keeps caret position and prevents clipping (818.422654ms)
  ✖ lists and tables auto-continue in fallback editor (2967.279393ms)
✖ Markdown inline editor (6594.094583ms)
✔ buildDeterministicPreview handles image-only markdown (1.447841ms)
✔ buildDeterministicPreview retains full image markdown when base64 exceeds preview cap (0.799494ms)
✔ buildDeterministicPreview preserves multiple images (0.480516ms)
✔ buildDeterministicPreview leaves long text untouched (0.320875ms)
✔ buildDeterministicPreview counts code and words alongside image (0.448879ms)
▶ Bounded previews
  ✖ preview clamps content with fade, continuation marker, and badges (1594.342353ms)
✖ Bounded previews (3263.933648ms)
▶ GravityStore.loadAllNotes
  ✔ ignores invalid persisted notes (2.32028ms)
  ✔ saveAllNotes persists only validated notes (0.723023ms)
  ✔ getById returns stored record or null (0.52978ms)
✔ GravityStore.loadAllNotes (4.928235ms)
▶ GravityStore export/import
  ✔ exportNotes serializes sanitized records (0.594125ms)
  ▶ importNotes appends only unique records
    ✔ imports new record with sanitized attachments (0.755493ms)
    ✔ skips records with duplicate identifiers (1.408432ms)
    ✔ skips records with identical content attachments and classification (0.30658ms)
    ✔ imports only unique subset when mixed (0.268538ms)
  ✔ importNotes appends only unique records (3.759199ms)
  ✔ importNotes rejects invalid payloads (0.762843ms)
✔ GravityStore export/import (5.396843ms)
ℹ tests 21
ℹ suites 5
ℹ pass 19
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7051.795906

✖ failing tests:

test at tests/editor.inline.puppeteer.test.js:174:9
✖ lists and tables auto-continue in fallback editor (2967.279393ms)
  AssertionError [ERR_ASSERTION]: Unordered list exit removes bullet
  actual expected
  
  '* Alpha\n* \n* Beta\n* '
  
      at TestContext.<anonymous> (file:///Users/tyemirov/Development/gravity/tests/editor.inline.puppeteer.test.js:229:28)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: '* Alpha\n* \n* Beta\n* ',
    expected: '* Alpha\n\n* Beta',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/preview.bounded.puppeteer.test.js:48:9
✖ preview clamps content with fade, continuation marker, and badges (1594.342353ms)
  AssertionError [ERR_ASSERTION]: long note should display fading overlay
      at TestContext.<anonymous> (file:///Users/tyemirov/Development/gravity/tests/preview.bounded.puppeteer.test.js:158:24)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1516:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
