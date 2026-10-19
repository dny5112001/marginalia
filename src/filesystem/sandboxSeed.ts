/**
 * Content for the in-memory sandbox shown when the UI runs in a plain browser
 * (e.g. `npm run dev` without Tauri). Nothing here is used by the desktop app,
 * which always works on real folders.
 */
export const sandboxSeed: Record<string, string> = {
  "Start here.md": `---
tags: [guide]
aliases: [Home]
---
# Start here

This is a **browser sandbox** — changes live in memory only. Run the desktop
app to work on real folders.

- Link notes with [[Ideas/Linking]] or [[Linking|an alias]]
- Tag things #guide
- [ ] Try the quick switcher (Mod+O)
- [x] Open this note
`,
  "Ideas/Linking.md": `# Linking

Back to [[Start here]]. See also [[Missing note]].

## Headings

Jump to [[Start here#Start here]].
`,
};
