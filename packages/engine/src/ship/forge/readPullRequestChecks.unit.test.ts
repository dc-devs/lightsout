import { describe, expect, test } from '@jest/globals';
import { readPullRequestChecks } from '#src/ship/forge/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** A forge whose `gh pr checks` prints these rows and exits as it really does — 8 while pending, 1 when red. */
const setupChecks = async ({ stdout, exitCode = 0 }: { stdout: string; exitCode?: number }) => {
	stubForgeOnPath({ responses: { 'pr checks': { stdout, exitCode } } });

	const cwd = await freshCwd();

	return { cwd };
};

describe('readPullRequestChecks', () => {
	test('every check green reports finished and green, naming what passed', async () => {
		const { cwd } = await setupChecks({ stdout: '[{"name":"unit","bucket":"pass"},{"name":"lint","bucket":"skipping"}]' });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd });

		expect(summary).toStrictEqual({ finished: true, green: true, failing: [], pending: [], passing: ['unit', 'lint'] });
	});

	test('a check still running reports unfinished and names it, which is what a timeout would report back', async () => {
		const { cwd } = await setupChecks({ stdout: '[{"name":"unit","bucket":"pass"},{"name":"e2e","bucket":"pending"}]', exitCode: 8 });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd });

		expect(summary).toStrictEqual({ finished: false, green: true, failing: [], pending: ['e2e'], passing: ['unit'] });
	});

	test('a red check is finished but not green, and both a failure and a cancellation count as red', async () => {
		const { cwd } = await setupChecks({ stdout: '[{"name":"unit","bucket":"fail"},{"name":"e2e","bucket":"cancel"}]', exitCode: 1 });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd });

		expect(summary).toStrictEqual({ finished: true, green: false, failing: ['unit', 'e2e'], pending: [], passing: [] });
	});

	test('a pull request with no checks configured reports an empty list, leaving what that means to the caller', async () => {
		const { cwd } = await setupChecks({ stdout: '[]' });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd });

		expect(summary).toStrictEqual({ finished: true, green: true, failing: [], pending: [], passing: [] });
	});

	test('output that is not the rows it asked for answers undefined, so the caller polls again instead of merging', async () => {
		const { cwd } = await setupChecks({ stdout: 'gh: could not reach the API', exitCode: 1 });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd });

		expect(summary).toBe(undefined);
	});
});
