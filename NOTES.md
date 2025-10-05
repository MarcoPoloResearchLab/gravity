## BugFixes

### Copying

Copying copies artifacts that shall not be copied
```copied content
- List
- of things
- I need to do

data:application/x-gravity-note+json;base64,eyJ2ZXJzaW9uIjoxLCJtYXJrZG93biI6Ii0gTGlzdFxuLSBvZiB0aGluZ3Ncbi0gSSBuZWVkIHRvIGRvIiwibWFya2Rvd25FeHBhbmRlZCI6Ii0gTGlzdFxuLSBvZiB0aGluZ3Ncbi0gSSBuZWVkIHRvIGRvIiwiYXR0YWNobWVudHMiOnt9fQ==
```

the data part is extraneous and unnessary. Have a test to ensure we do have proper copying of images and texts but no weird artifiacts

### Display clipping

Editing doest keep the cursor at the end of the note, but clips (hides the bottom of the note and the cursor) on a second click. the second click in the same note shall either place the cursor in the new place of the click, or do nothing if the curosr stays where it is

### Autocontinuation

there is no more autocintuation of lists or tables. That was in the shared prototype, when lists tables etc were autocntinued e.g. an enter ina  numbered or bulletted list will add a new item. have comprehensive tests for mardown editing

› review the notes.md. make a plan for autonomously fixing every bug. ensure no regressions. ensure adding tests. lean into integration tests. fix every bug.