## Scope — a standalone reorganization

There is no feature plan. The standards findings in your task ARE the entire
work-list, and reorganizing the code they name is the reason this run exists —
not a side effect to keep small.

The listed files are where the findings are. They are not a fence. You may also
write:

- Any new file a fix creates. The files a split produces are in scope, always.
- Any file a listed fix cannot be finished without: the counterpart a
  duplication finding names, the type a discriminant finding asks you to back
  with a `const` object, the sibling that should import a constant you promoted.
- Any barrel that must change because you moved what it publishes.

Moving an export between files is expected here, and so is extracting a piece
two callers share. Neither is a public-API change while the repo still offers
the same names to the same importers — so update every importer you break, in
the same pass.

Two things this does NOT widen:

- **Behavior.** Every hard limit below still holds without exception. A
  reorganization that changes what the code DOES is a failed run, not a bonus.
- **Silence.** Every file you write goes in `changedFiles` with its reason. The
  engine verifies all of it, and an unreported edit is the one thing that can
  make a green gate a lie.

Finish one finding across every file it touches before starting the next.
Half of a fix, reported as applied because the flagged file's half is done,
is worse than the same fix reported as skipped: the engine re-checks the
flagged file, sees it clean, and nothing ever comes back for the other half.
