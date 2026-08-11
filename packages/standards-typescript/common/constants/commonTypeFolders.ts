/**
 * The four names folder-structure.md makes `common/`'s own closed vocabulary —
 * its always-built type-folder skeleton.
 *
 * One list serving two rules, because the doc states it once. It is the banned
 * list's lower tier: inside a `common/` these names are mandated, so
 * `path-banned-module-name` bans them only elsewhere, where they are a
 * technical-layer bucket standing in for a domain. And a folder directly under
 * `common/` that is NOT one of them is a graduated domain folder, which is what
 * `path-domain-folder-single-file` judges — the skeleton itself is never
 * judged.
 */
export const commonTypeFolders: ReadonlySet<string> = new Set(['utils', 'types', 'constants', 'services']);
