/** What one coverage scope's Jest configuration says about the files it collects coverage from. */
export interface CoverageCollection {
	/** Absolute, resolved Jest rootDir — every glob in collectCoverageFrom is written against it. */
	rootDir: string;
	/** `collectCoverageFrom` in config order: a plain glob includes, a `!`-prefixed glob excludes. Undefined when the key is absent, which means Jest measures only what a test imports and the engine cannot predict the set. */
	collectCoverageFrom: string[] | undefined;
	/** `coveragePathIgnorePatterns` as regular-expression sources, matched against the absolute path. Jest's own default (`/node_modules/`) when the key is absent. */
	coveragePathIgnorePatterns: string[];
}
