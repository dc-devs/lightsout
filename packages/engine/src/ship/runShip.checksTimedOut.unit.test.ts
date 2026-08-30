import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ShipMergeMethod } from '#src/contracts/index.ts';
import type { ChecksSummary } from '#src/ship/forge/index.ts';
import { runShip } from '#src/ship/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

// Mocked Imports
// -------------------------
// A scenario of its own because the waiting is the one collaborator no
// arrangement can hurry: a real wait reports unfinished only at its half-hour
// ceiling, and no stubbed forge brings that ceiling closer. Everything else
// here stays real — a real worktree, a real push, a fake `gh` on PATH — so what
// these tests pin is what the sequence does with a wait that ran out, not how
// the waiting itself works, which the wait's own tests cover.

interface WaitForChecksParams {
	prNumber: number;
	cwd: string;
	onProgress?: (message: string) => void;
}

const mockWaitForChecks = jest.fn<(params: WaitForChecksParams) => Promise<ChecksSummary>>();

jest.mock('#src/ship/waitForChecks.ts', () => ({ waitForChecks: (params: WaitForChecksParams) => mockWaitForChecks(params) }));
// -------------------------

const viewed = '{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Add the ship command","headRefName":"lo-60-ship"}';

/** The settings a resolved `ship` block hands the sequence — this repo's own, with its nested ticket groups. */
const settings = {
	ticketPattern: /^(?<ticket>lo-(?<number>\d+))/,
	pullRequestBody: 'Closes LO-{number}',
	mergeMethod: ShipMergeMethod.Merge,
	afterImplement: false,
	preShip: undefined,
};

/** A branch that gets as far as an open pull request, whose checks are still running when the wait gives up. */
const setupTimedOut = () => {
	const { readForgeLog } = stubForgeOnPath({
		responses: {
			'auth status': { exitCode: 0 },
			'pr list': { stdout: '[]' },
			'pr create': { stdout: 'https://forge.example/acme/repo/pull/41' },
			'pr edit': { exitCode: 0 },
			'pr view': { stdout: viewed },
			'pr merge': { exitCode: 0 },
		},
	});

	mockWaitForChecks.mockResolvedValue({ finished: false, green: true, failing: [], pending: ['e2e', 'lint'], passing: ['unit'] });

	const { cwd } = setupBranchRepo({ branch: 'lo-60-ship' });

	return { cwd, readForgeLog };
};

describe('runShip', () => {
	test('checks still running when the wait gives up block, naming every check that never finished', async () => {
		const { cwd } = setupTimedOut();

		const result = await runShip({ cwd, settings });

		expect(result).toEqual(
			expect.objectContaining({
				status: 'blocked',
				reason: 'checks-timed-out',
				branch: 'lo-60-ship',
				ticketRef: 'lo-60',
				failingChecks: ['e2e', 'lint'],
			}),
		);
	});

	test('a wait that ran out leaves the pull request unmerged, because nothing here merges on an unfinished check', async () => {
		const { cwd, readForgeLog } = setupTimedOut();

		await runShip({ cwd, settings });

		expect(readForgeLog().some((line) => line.startsWith('pr merge'))).toBe(false);
	});

	test('writes the blocked result to disk, which is how the next tool learns the merge did not happen', async () => {
		const { cwd } = setupTimedOut();

		const result = await runShip({ cwd, settings });

		expect(JSON.parse(await readFile(join(cwd, '.lightsout', 'ship', 'lo-60-ship.json'), 'utf8'))).toStrictEqual(result);
	});
});
