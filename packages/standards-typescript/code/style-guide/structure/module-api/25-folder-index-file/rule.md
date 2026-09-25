---
summary: "an `index.ts` in a folder that is not a package's entry"
checked: true
severity: advisory
---

## No Folder Index Files

An `index.ts` is a package's entry — the file its manifest publishes to other packages — and nothing else.

- **Every import already names the declaring file**, so an `index.ts` in a folder lists names that nothing reads through it. It is a second copy of what the folder holds, kept by hand, that drifts the first time someone adds a file and forgets it.
- **A package's entry stays.** Other packages import it, so it is the package's contract. It sits at the package root or its `src/`, or the manifest names it — a subpath export such as `"./contracts": "./src/contracts/index.ts"` makes that file an entry too.
- **A route is not an index file.** A file router's `src/routes/index.tsx` is a route the framework loads.

Delete a folder's `index.ts`, and import each name from the file that declares it.
