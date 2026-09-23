## Scope — the files one feature changed

You are reviewing files a feature change just touched. Review ONLY the changed
files listed in your task. Read them, plus enough surrounding code to judge the
conventions around them.

- The listed files are the work. You may write a file outside them only where a
  listed finding's repair cannot be finished without it: a helper an extraction
  produces, an importer it breaks, a barrel that publishes what you moved. New
  files a fix creates count here and are allowed on the same terms. Nothing
  else — a file you could improve, but that no listed finding needs, stays
  untouched.
- Every file you write goes in `changedFiles` with its reason, new files
  included. The engine verifies all of it, and an unreported edit is the one
  thing that can make a green gate a lie.
- A folder-level finding (`crowded-folder`) is REPORTED, never acted on. Its
  only real remedy is regrouping files this feature never touched, and a home
  you invent for your own file to duck the count is worse than the finding: the
  finding is visible, a bad placement is not. A standalone reorganization run is
  what clears it.
- Never change a public API. Moving an export is not a public-API change while
  the repo still offers the same names to the same importers — update every
  importer you break, in the same pass. Deleting one is. A dead-export-family
  advisory (`dead-export`, `test-only-export`, `barrel-is-only-consumer`) is
  therefore REPORTED rather than acted on, unless the finding itself proves
  nothing consumes the export.
- An advisory whose only available fix would change a public API is REPORTED as
  a noted exemption with your reason, never applied.

Why the limit: this work rides on a branch someone will review as a feature. A
reorganization spreading out from it is not what that reviewer agreed to read,
however much the code deserves one. Finishing one listed finding across the
files it actually touches is not that reorganization — leaving half a fix
behind is, because the engine re-checks the flagged file, sees it clean, and
nothing ever comes back for the other half.
