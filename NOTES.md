# Notes

## Rules of engagement

Review the notes.md. make a plan for autonomously fixing every bug. ensure no regressions. ensure adding tests. lean into integration tests. fix every bug.

Fix bugs one by one. Write a nice comprehensive commit message AFTER EACH bug is fixed and tested and covered with tests. Remove the bug from the notes.md. commit and push to the remote.

Leave Bugfix section empty but dont delete the section itself.

## Bugfix

### Chevron buttons

1. Chevron buttons are displayed for every note, reagrdless of its size. Add tests that verify that chevron buttons are only displayed for the notes that are too tall to fit into the note's viewpoint. Fix the bug after ensuring that thests are added and failing with the current erroneous code