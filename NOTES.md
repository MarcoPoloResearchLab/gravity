# Notes

## Rules of engagement

Review the NOTES.md. Make a plan for autonomously fixing every item under Features, BugFixes, Improvements, Maintenance. Ensure no regressions. Ensure adding tests. Lean into integration tests. Fix every issue. Document the changes.

Fix issues one by one. Write a nice comprehensive commit message AFTER EACH issue is fixed and tested and covered with tests. Do not work on all issues at all. Work at one issue at a time sequntially. 

Remove an issue from the NOTES.md after the issue is fixed (new tests are passing). Commit the changes and push to the remote.

Leave Features, BugFixes, Improvements, Maintenance sections empty when all fixes are implemented but don't delete the sections themselves.

## Features

## Improvements

## BugFixes

- [ ] [GN-02] Do not return the cursor / focus back to the first note after CMD + Enter. Let it stay unfocused and let user choose where to click next. Do have cursor placed in the first note when the website is loaded, tho   
- [ ] [GN-03] Add Shift-Tab description as a shortcut that does negative indent / moves indent back to the list of shortcuts (visible on F1)
- [ ] [GN-04] I have updated a note, then pushed down cursor arrow and the note didn't bubble up after editing. Ensure that the notes always bubble up after being edited -- develop a robust mechanism, maybe through state management

## Maintenance
