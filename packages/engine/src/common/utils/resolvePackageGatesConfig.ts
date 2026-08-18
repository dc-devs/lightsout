import type { PackageGates } from '@/contracts';

/** The kebab keys the scoped block fixes; anything else that made it through the schema is a custom `test-*` suite. */
const fixedKeys = new Set(['check', 'test', 'test-coverage', 'build']);

interface Params {
	packageGates: PackageGates;
}

/** The scoped `packageGates` block, read into the engine's own spelling. */
interface ResolvedPackageGates {
	check: string;
	test: string;
	testCoverage?: string;
	build?: string;
	/** Custom `test-*` suite templates, in the order the config wrote them. */
	extraTests: { name: string; command: string }[];
}

/**
 * Read a parsed `packageGates` block. The schema validates and keeps the
 * config's own kebab spelling (so manifests round-trip); this is the one
 * place that spelling is translated for the engine.
 */
export const resolvePackageGatesConfig = ({ packageGates }: Params): ResolvedPackageGates => ({
	check: packageGates.check,
	test: packageGates.test,
	...(packageGates['test-coverage'] === undefined ? {} : { testCoverage: packageGates['test-coverage'] }),
	...(packageGates.build === undefined ? {} : { build: packageGates.build }),
	extraTests: Object.entries(packageGates)
		.filter((entry): entry is [string, string] => !fixedKeys.has(entry[0]) && typeof entry[1] === 'string')
		.map(([name, command]) => ({ name, command })),
});
