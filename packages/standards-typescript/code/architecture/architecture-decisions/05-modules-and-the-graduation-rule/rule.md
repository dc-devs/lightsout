---
summary: "a folder created for a concept with no private companions, or a folder's internals reached from outside it"
checked: false
severity: advisory
---

## Modules & the Graduation Rule

A **module** is a unit of code with a public API and private internals. TypeScript enforces privacy at the file level (non-exported = invisible); folder-level boundaries are convention the repo may enforce with tooling.

**Every concept starts as a file and earns its folder:**

- **File-module (default):** a single file holding one exported item plus non-exported helpers. The compiler enforces the boundary for free.
- **Folder-module (graduated):** when a concept needs private companions — its own utils, types, or constants that serve only it — it graduates to a folder holding the concept and its companions.
- **Born folders:** features, route modules, and screens are inherently multi-file and start as folder-modules.

**The trigger is mechanical:** *needs private companion files → folder; doesn't → file.* Never create folder ceremony for a one-file concept.

**Borderline cases are decided by the companion test:** does any of the concept's files serve only the concept itself? No → the concept is primitives; its files belong in `common/<type>/`. Yes → it is a module. This applies to shared code too: a shared concept with private companions graduates OUT of `common/` into its own module ([folder-structure.md](./folder-structure.md#what-lives-in-common--the-companion-test)).

**Boundary rules for folder-modules:**

1. Every import names the file that declares what it imports. A folder carries no `index.ts`; only a package's entry does, and code inside the package never imports through it.
2. Code outside a folder-module imports the files it is meant to use — the concept's own file, and what that file's callers need — never the companions that serve only the concept
3. Inside a module, imports between its files are correct
4. Tests target the module's public files; its companions are covered through them (a `.unit.test.ts` beside a file marks it as a boundary; files under a module's `common/` have none of their own)
5. Test imports obey the same boundary: a test OUTSIDE a module imports only its public files, never its companions — including in repos that keep tests in a separate directory. (A test living beside its file is inside the module; it imports that file directly.)

The rule is recursive — a graduated component folder inside a feature folder is a module within a module.
