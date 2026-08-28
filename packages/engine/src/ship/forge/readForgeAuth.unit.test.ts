import { describe, expect, test } from '@jest/globals';
import { readForgeAuth } from '#src/ship/forge/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** A repo whose `gh auth status` answers as the test asks it to. */
const setupAuth = ({ exitCode }: { exitCode: number }) => {
	stubForgeOnPath({ responses: { 'auth status': { exitCode, stderr: exitCode === 0 ? '' : 'not logged in' } } });

	const { cwd } = setupBranchRepo();

	return { cwd };
};

describe('readForgeAuth', () => {
	test('a logged-in gh answers true', async () => {
		const { cwd } = setupAuth({ exitCode: 0 });

		const authenticated = await readForgeAuth({ cwd });

		expect(authenticated).toBe(true);
	});

	test('a gh that refuses answers false — the caller’s message names both ways it can refuse', async () => {
		const { cwd } = setupAuth({ exitCode: 1 });

		const authenticated = await readForgeAuth({ cwd });

		expect(authenticated).toBe(false);
	});
});
