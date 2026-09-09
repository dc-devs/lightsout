import { describe, expect, test } from '@jest/globals';
import { readPullRequestChecks } from '#src/ship/forge/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** The commit the caller pushed and is asking about — the only head whose rows may count. */
const candidateHead = 'aaa1111aaa1111aaa1111aaa1111aaa1111aaa11';

/** A forge whose `gh pr checks` prints these rows and exits as it really does — 8 while pending, 1 when red. */
const setupChecks = async ({ stdout, exitCode = 0 }: { stdout: string; exitCode?: number }) => {
	stubForgeOnPath({ responses: { 'pr view': { stdout: JSON.stringify({ headRefOid: candidateHead }) }, 'pr checks': { stdout, exitCode } } });

	const cwd = await freshCwd();

	return { cwd };
};

/** A forge whose pull request head answers one entry per read, so the read before the check query and the read after it can disagree. */
const setupCandidate = async ({ heads, stdout }: { heads: string[]; stdout: string }) => {
	stubForgeOnPath({
		responses: {
			'pr view': heads.map((headRefOid) => ({ stdout: JSON.stringify({ headRefOid }) })),
			'pr checks': { stdout },
		},
	});

	const cwd = await freshCwd();

	return { cwd };
};

/** A forge whose pull request read answers something that is not the head at all — a login prompt, a rate-limit page, a body without the field. */
const setupUnreadableHead = async ({ stdout, exitCode = 1 }: { stdout: string; exitCode?: number }) => {
	stubForgeOnPath({ responses: { 'pr view': { stdout, exitCode }, 'pr checks': { stdout: '[{"name":"unit","bucket":"pass"}]' } } });

	const cwd = await freshCwd();

	return { cwd };
};

/** A different head, so a summary read under it would describe a commit the caller never asked about. */
const otherHead = 'bbb2222bbb2222bbb2222bbb2222bbb2222bbb22';

/** The three readings that cannot prove the rows belong to the expected candidate: a head that was already wrong, a head that moved while the rows were read, and a verdict outside the supported buckets. */
const unprovableCandidates = [
	{ heads: [otherHead], stdout: '[{"name":"unit","bucket":"pass"}]' },
	{ heads: [candidateHead, otherHead], stdout: '[{"name":"unit","bucket":"pass"}]' },
	{ heads: [candidateHead], stdout: '[{"name":"unit","bucket":"pass"},{"name":"e2e","bucket":"neutral"}]' },
];

describe('readPullRequestChecks', () => {
	test('every check green reports finished and green, naming what passed', async () => {
		const { cwd } = await setupChecks({ stdout: '[{"name":"unit","bucket":"pass"},{"name":"lint","bucket":"skipping"}]' });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd, expectedHead: candidateHead });

		expect(summary).toStrictEqual({ finished: true, green: true, failing: [], pending: [], passing: ['unit', 'lint'], readable: true });
	});

	test('a check still running reports unfinished and names it, which is what a timeout would report back', async () => {
		const { cwd } = await setupChecks({ stdout: '[{"name":"unit","bucket":"pass"},{"name":"e2e","bucket":"pending"}]', exitCode: 8 });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd, expectedHead: candidateHead });

		expect(summary).toStrictEqual({ finished: false, green: true, failing: [], pending: ['e2e'], passing: ['unit'], readable: true });
	});

	test('a red check is finished but not green, and both a failure and a cancellation count as red', async () => {
		const { cwd } = await setupChecks({ stdout: '[{"name":"unit","bucket":"fail"},{"name":"e2e","bucket":"cancel"}]', exitCode: 1 });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd, expectedHead: candidateHead });

		expect(summary).toStrictEqual({ finished: true, green: false, failing: ['unit', 'e2e'], pending: [], passing: [], readable: true });
	});

	test('a pull request with no checks configured reports an empty list, leaving what that means to the caller', async () => {
		const { cwd } = await setupChecks({ stdout: '[]' });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd, expectedHead: candidateHead });

		expect(summary).toStrictEqual({ finished: true, green: true, failing: [], pending: [], passing: [], readable: true });
	});

	test('output that is not the rows it asked for answers undefined, so the caller polls again instead of merging', async () => {
		const { cwd } = await setupChecks({ stdout: 'gh: could not reach the API', exitCode: 1 });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd, expectedHead: candidateHead });

		expect(summary).toBe(undefined);
	});

	test('a head that cannot be read at all answers undefined, so unreadable evidence never counts as the expected candidate', async () => {
		const { cwd } = await setupUnreadableHead({ stdout: 'gh: authentication required' });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd, expectedHead: candidateHead });

		expect(summary).toBe(undefined);
	});

	test.each(unprovableCandidates)('refuses checks that cannot prove the expected candidate state', async ({ heads, stdout }) => {
		const { cwd } = await setupCandidate({ heads, stdout });

		const summary = await readPullRequestChecks({ prNumber: 41, cwd, expectedHead: candidateHead });

		expect(summary).toBe(undefined);
	});
});
