/**
 * Resolves one import specifier to a repo-relative file in the resolver's own
 * universe — `undefined` when the specifier lands outside it, or when a suffix
 * match is ambiguous.
 */
export type SpecifierResolver = ({ from, specifier }: { from: string; specifier: string }) => string | undefined;
