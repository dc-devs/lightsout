---
summary: "two sibling paths that differ only by casing"
checked: true
severity: blocking
---

**Case collisions are latent breakage.** Two sibling entries whose names differ only by casing — `readme.md` beside `README.md`, or a source file whose stem matches a sibling folder's name in another case, like `Gates.ts` beside `gates/` — resolve to one entry on a case-insensitive filesystem (macOS, Windows) and to two on a case-sensitive one (Linux CI). An import that works on the machine that wrote it silently picks a different target on the machine that checks it. A type checker only objects once both spellings are imported in one build, and a plain-JavaScript repo has no type checker at all — so the tree itself must never carry the ambiguity. Rename one side.
