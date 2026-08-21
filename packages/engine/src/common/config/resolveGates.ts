import type { ConfigGates } from '#src/contracts/index.ts';

/** The kebab keys every gates block fixes; anything else that made it through the schema is a custom `test-*` suite. */
const fixedKeys = new Set(['check', 'test', 'test-coverage', 'generate', 'build', 'format']);

interface Params {
	gates: ConfigGates;
}

/** The root gates block, read into the engine's own spelling. */
interface ResolvedGates {
	check: string;
	test: string;
	/** `false` is the explicit coverage opt-out the config contract requires. */
	testCoverage: string | false;
	generate?: string;
	build?: string;
	format?: string;
	/** Custom `test-*` suites, in the order the config wrote them. */
	extraTests: { name: string; command: string }[];
}

/**
 * Read a parsed `gates` block. The schema validates and keeps the config's
 * own kebab spelling (so manifests round-trip); this is the one place that
 * spelling is translated for the engine, custom `test-*` suites included.
 */
export const resolveGates = ({ gates }: Params): ResolvedGates => ({
	check: gates.check,
	test: gates.test,
	testCoverage: gates['test-coverage'],
	...(gates.generate === undefined ? {} : { generate: gates.generate }),
	...(gates.build === undefined ? {} : { build: gates.build }),
	...(gates.format === undefined ? {} : { format: gates.format }),
	extraTests: Object.entries(gates)
		.filter((entry): entry is [string, string] => !fixedKeys.has(entry[0]) && typeof entry[1] === 'string')
		.map(([name, command]) => ({ name, command })),
});
