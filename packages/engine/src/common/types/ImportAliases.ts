/**
 * The subpath imports each package declares in its package.json `imports`
 * field, keyed by the repo-relative directory holding that package.json (`.`
 * for the repo root). A package whose manifest declares none still has an
 * entry, with no patterns: its manifest is the scope Node resolves a `#`
 * specifier in, and an empty scope answers "no such alias" rather than
 * deferring to a manifest further up.
 */
export type ImportAliases = Map<string, Array<{ pattern: string; target: string }>>;
