# Comic chapter artwork

Keep comic image files in this directory in the Git repository. The admin portal stores chapter metadata and local file paths in Supabase; it cannot upload, edit, or delete repository files. Add or remove images in the codebase and deploy those file changes with the app.

Use paths beginning with `assets/comics/`, for example:

```text
assets/comics/chapter-01/cover.webp
assets/comics/chapter-01/page-01.webp
assets/comics/chapter-01/page-02.webp
```

In **Admin Portal → Comic chapters**, enter the cover path and one page path per line in reading order. Supported image formats include JPEG, PNG, WebP, GIF, and AVIF. Use simple filenames containing letters, numbers, periods, underscores, and hyphens. The editor allows up to 50 page paths per chapter.

New chapters receive the next available number; numbering remains stable when a chapter is archived. Chapters unlock in number order from completed two-party handoff confirmations stored in Supabase. Apply the `20261020000100_admin_comic_chapter_editor.sql` migration before using the editor.
