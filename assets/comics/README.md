# Comic chapter artwork

The `My Journey` page displays the comic series. Add original artwork under this folder, grouped by chapter:

```text
assets/comics/
  chapter-01/
    cover.webp
    page-01.webp
    page-02.webp
  chapter-02/
    cover.webp
    page-01.webp
```

After adding files, update the matching entry in [`js/comic-chapters.js`](../../js/comic-chapters.js):

- Set `cover` to a site-relative path such as `./assets/comics/chapter-01/cover.webp`.
- Add each page path, in reading order, to `pages`.
- Set the chapter title supplied by the design team.
- For chapter numbers not listed yet, add an entry with the next number; progression itself has no fixed chapter cap.

Only unlocked chapters display their artwork. Chapter unlocks and achievements come from completed two-party handoff confirmations stored in Supabase.
