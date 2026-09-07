interface Params {
	/** The config's own gate key, as an acceptance-test row carries it: 'test', 'test-coverage', 'test-e2e'. */
	gate: string;
	/** The gate family a result records: 'check', 'test', 'testCoverage', 'build', or a custom suite's own name. */
	kind: string;
}

/**
 * Whether a gate execution of this family answers for a row naming that gate
 * key — the one translation between the two vocabularies `buildGateEntries`
 * keeps side by side.
 *
 * A row naming `test` is satisfied by the coverage gate too, because the
 * schedule substitutes the instrumented gate for the plain one and it runs the
 * same suite; without that, a row naming `test` would be unprovable at every
 * checkpoint that runs coverage. Every other key — the custom suites included —
 * is satisfied by the kind of the same name, which is what `buildGateEntries`
 * records for them.
 */
export const satisfiesGateKey = ({ gate, kind }: Params): boolean => {
	if (gate === 'test') {
		return kind === 'test' || kind === 'testCoverage';
	}

	return gate === 'test-coverage' ? kind === 'testCoverage' : kind === gate;
};
