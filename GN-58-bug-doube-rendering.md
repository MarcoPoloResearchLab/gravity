# GN-58 Markdown Double Rendering

## Problem: The editor is broken: it duplicates the editing text. 

### Context

For example, the note containing this text shows markdown twice

```
- [ ] No lines separating the first card from the next
- [ ] 
```

There is ![the screenshot](image.png) that demonstrates the bug. The bug is manifested in two areas
  1. There is a scroller on the screen -- and we must never have a scroller in the system
  2. The markdown is double-rendered
Fixing the bug will get rid of both symptoms.

### History

Despite days of work the bug hasn't been fixed. Instead a new bug has been introduced: the second markdown line `- [ ]` stops rendering, yet editing still shows duplicate markdown.

Feel free to disreard all and any code attempts and start from scratch. The code has no value if it doesnt do what user expects.

## Success criteria

1. First level of success (making progress): all tests below are failing, reflecting the actual grip on teh behavior
2. Second level of success: (solution) -- all tests are passing without tests being edited from p1. and only code being edited

### Tests

  1. write a test that analyzes editing a note with the following content:
     ```markdown
     - [ ] unique1
     - [ ]
     ```
  2. The test must take a screenshot and analyze the screenshot of rendered content
     2a) there are two checkmarks rendered.
     2b) clicking on each checkmark marks it as a check.
     2c) switching to markdown shows that the checkmark is checked.
       i) Clicking on the first checkmark produces the following markdown
       ```markdown
       - [x] unique1
       - [ ]
       ```
       ii) Clicking on the second checkmark produces the following markdown
       ```markdown
       - [ ] unique1
       - [x]
       ```
     2d) switching to markdown without clicking the checkmarks shows editing of the expected content:
     ```markdown
     - [ ] unique1
     - [ ]
     ```
     2e) switching to markdown shows the word "unique1" once in the screenshot
     2e) switching to markdown shows no scroller in the screenshot
  3. The test must be failing first or we didnt write a proper test because the code doesnt work.
     3a. Develop general abilities of screenshot analysis (find words in screenshot, find colors in screenshot)

### Preparations for solution in the code

Dilligently investigate why such double markdown representation is possible. radically simplify the implementation leaning into the MDE amd marked.js. Ensure we have tests that guratee that we dont perform any operations twice and that we dont show markdown twice. This is the most critical issue, spend a liot of compute to get it right.

1. Read [text](MDE.v2.19.0.md) and [text](marked.js.md).
2. Refactor the general approach to notes editing. ensure that a single card can not be both editied and rendered at the same time. centralize the ability to display the markdown vs rendering the text so that rendering and editing are mutually exclusive states. Write code in such a manner that a card can not be both rendered and edited at the same time
3. Ensure that editing can not edit more than once: re-work the implementation to ensure that there is only one copy of markdown editing
