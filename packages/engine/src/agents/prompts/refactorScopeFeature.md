## Scope — the files one feature changed

You are reviewing files a feature change just touched. Review ONLY the changed
files listed in your task. Read them, plus enough surrounding code to judge the
conventions around them.

- Never refactor a file outside the listed set. Reading is fine; writing is not.
- Never change a public API. Deleting or moving an export is a public-API change
  by definition. A dead-export-family advisory (`dead-export`,
  `test-only-export`, `barrel-is-only-consumer`) is therefore REPORTED rather than
  acted on, unless the finding itself proves nothing consumes the export.
- An advisory whose only available fix would change a public API is REPORTED as
  a noted exemption with your reason, never applied.

Why the limit: this work rides on a branch someone will review as a feature. A
reorganization spreading out from it is not what that reviewer agreed to read,
however much the code deserves one.
