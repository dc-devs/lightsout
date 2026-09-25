---
summary: "an import through an `index.ts` of the importer's own package instead of from the file that declares the name"
checked: true
severity: advisory
---

## Import From the Declaring File

Every import names the file that declares what it imports — `@/ingestion/ingestRecords`, never `@/ingestion`.

- **Never through an `index.ts`:** an import through one loads every file it re-exports, and everything those files import, to reach one name. A bundler drops the rest again; a test runner does not, so every test file that imports through an index pays for the whole folder.
- **Another package's entry is its public API:** an import from another workspace package goes through that package's entry — `@acme/engine`, not a path into its `src/`. Code inside a package never imports its own entry.
- **An index file may re-export from another**, and an index file's own test imports the file it tests.

A route file the framework loads is not an index file in this sense — `src/routes/index.tsx` is a route, and importing it is importing that route.

Where a package keeps its folders is the package's own business, so this rule judges only a file that belongs to a package. Where the repo's manifests declare workspace packages, a file outside every one of them — a build script at the repo root, say — is not held to it. A repo whose manifests declare no workspace package is itself one package, and every file in it is judged.
