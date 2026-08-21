interface Params {
	/** Repo-relative path — its extension is the whole answer. */
	path: string;
}

/**
 * Only the JS/TS family earns agent turns (test writers, refactor review) —
 * every spawn costs a model call, so unknown file types default to zero
 * wasted turns. Allowlist: .js/.jsx/.ts/.tsx plus the m/c module variants.
 */
export const isTestableSourceFile = ({ path }: Params): boolean => /\.(m|c)?[jt]sx?$/i.test(path);
