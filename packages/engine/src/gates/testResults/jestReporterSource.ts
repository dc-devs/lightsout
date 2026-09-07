import { testReporterEnv } from '#src/common/constants/testReporterEnv.ts';

/**
 * The engine's jest reporter, held as a CommonJS source string.
 *
 * A string constant rather than a file the bundler copies, for the reason the
 * prompts are strings: a source file the engine writes to disk at run time is
 * carried by the bundle as text, so no second esbuild loader is needed.
 *
 * One file per jest process is what makes this work in a monorepo: a repo whose
 * unit-test script fans out into one jest process per package has every one of
 * them inherit the same results directory, and a single shared output file would
 * be overwritten by whichever process finished last.
 *
 * Every write error is swallowed. A reporter that fails a suite it is only
 * observing would turn evidence collection into a new way for a run to die.
 */
export const jestReporterSource = `const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Records what each jest process actually ran, for the lightsout engine to read
 * back after the gate command exits. Inert wherever the engine's environment
 * variables are unset, which is every ordinary developer run.
 */
class LightsoutJestReporter {
	onRunComplete(contexts, results) {
		const dir = process.env['${testReporterEnv.resultsDir}'];

		if (!dir) {
			return;
		}

		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, process.pid + '-' + Date.now() + '.json'),
				JSON.stringify({
					testResults: ((results && results.testResults) || []).map(function (file) {
						return {
							testFilePath: file.testFilePath,
							assertionResults: (file.testResults || []).map(function (assertion) {
								const result = {
									title: assertion.title,
									ancestorTitles: assertion.ancestorTitles || [],
									fullName: assertion.fullName,
									status: assertion.status,
								};

								if (typeof assertion.duration === 'number') {
									result.durationMs = assertion.duration;
								}

								return result;
							}),
						};
					}),
				}),
			);
		} catch {
			// Evidence is best-effort: a reporter that throws would fail a suite it
			// is only watching, and the engine already treats missing results as
			// missing evidence.
		}
	}
}

module.exports = LightsoutJestReporter;
`;
