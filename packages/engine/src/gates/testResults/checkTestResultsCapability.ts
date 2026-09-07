import { join } from 'node:path';
import { testReporterEnv } from '#src/common/constants/testReporterEnv.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { readTestResults } from '#src/gates/testResults/readTestResults.ts';
import { satisfiesGateKey } from '#src/gates/testResults/satisfiesGateKey.ts';

/** How a repository switches the reporter on, spelled out so the message alone is enough to fix the setup. */
const setupAdvice = [
	'',
	`lightsout sets ${testReporterEnv.reporter} (the reporter file it wrote into the run folder) and ${testReporterEnv.resultsDir} (where that execution's results go) on every gate command.`,
	"Only a jest suite that loads that reporter can prove an acceptance test ran. Add one entry to the suite's jest config:",
	'',
	`\tconst lightsoutReporter = process.env.${testReporterEnv.reporter};`,
	"\treporters: lightsoutReporter ? ['default', lightsoutReporter] : ['default'],",
	'',
	"Naming the `reporters` key replaces jest's default, so 'default' has to be restated. With the variables unset the reporter does nothing.",
	"A gate that is not jest — a lint, a build, another runner's suite — can carry no test result at all; point the ledger row at a jest gate instead.",
];

interface Params {
	cwd: string;
	/** The gate keys the plan's ledger names, distinct. */
	gates: string[];
	/** Every gate result the clean-slate checkpoint observed. */
	results: GateResult[];
	/** One line per ledger gate that did not run at all. Silent when omitted. */
	onProgress?: (message: string) => void;
}

/**
 * The early setup probe: did the configured gates produce any per-test evidence
 * at all?
 *
 * Clean-slate is the last free moment. After it the run starts paying for
 * agents, and a repository whose jest config never loads the reporter would
 * otherwise not find out until its final checkpoint, having bought every agent
 * turn in between.
 *
 * The question is asked per package group rather than per key, because the
 * acceptance check matches evidence per group too: in a monorepo where one
 * package's jest config loads the reporter and another's does not, a row in the
 * second package would otherwise reach its checkpoint with a counting result
 * that proves nothing.
 *
 * A key whose gate did not run at clean-slate is skipped rather than failed — a
 * gate override may legitimately drop it, and the run's final verification is
 * where an unproven row fails.
 */
export const checkTestResultsCapability = async ({ cwd, gates, results, onProgress }: Params): Promise<string | undefined> => {
	const silent: string[] = [];

	for (const gate of [...new Set(gates)]) {
		const greens = results.filter((result) => result.skipped !== true && result.exitCode === 0 && satisfiesGateKey({ gate, kind: result.kind }));

		if (greens.length === 0) {
			onProgress?.(`per-test evidence: gate \`${gate}\` did not run at clean-slate, so its reporter setup could not be probed`);

			continue;
		}

		for (const green of greens) {
			const written = green.testResultsDir === undefined ? [] : await readTestResults({ cwd, dir: join(cwd, green.testResultsDir) });

			if (written.length === 0) {
				silent.push(`- gate \`${gate}\` in group \`${green.group}\` ran green and wrote no per-test results`);
			}
		}
	}

	return silent.length === 0
		? undefined
		: [
				"per-test evidence: this plan's acceptance tests cannot be proven, because a gate the ledger names produced no per-test results:",
				...silent,
				...setupAdvice,
			].join('\n');
};
