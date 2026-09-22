import { execSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { GateRunResult } from '#src/gates/index.ts';
import type { ShipWorkOrderGuard } from '#src/ship/index.ts';
import { ShippingProgressRecorder } from '#src/ship/progress/index.ts';
import { runShipAttempt } from '#src/ship/runShipAttempt.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { shipTicketGuardFixture } from '#tests/helpers/shipTicketGuardFixture.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

// Mocked Imports
// -------------------------
// The repository's own gates are another module's entry point, covered by their
// own tests. Stubbed here so the verified candidate is decided by this file
// rather than by whichever commands the shared integration fixture configures.
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({ runGates: (params: { cwd: string }) => mockRunGates(params) }));
// -------------------------

/**
 * One complete candidate: a real branch whose origin has not moved, so the
 * integration step has nothing to merge and leaves `HEAD` where it stands —
 * which is what lets the forge stub name the pushed candidate commit the
 * sequence asks the forge to match.
 *
 * One `pr view` answer carries every field the sequence reads, because the stub
 * answers on an argument prefix while the sequence asks the same pull request
 * for several different field lists.
 */
const setupAttempt = () => {
	const branch = 'lo-89-attempt';
	const { cwd } = setupBranchRepo({ branch });
	const candidateHead = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
	const viewed = JSON.stringify({
		number: 41,
		url: 'https://forge.example/acme/repo/pull/41',
		title: 'Add the feature',
		headRefName: branch,
		headRefOid: candidateHead,
		state: 'MERGED',
		mergeCommit: { oid: '0f1e2d3c' },
		mergeStateStatus: 'CLEAN',
		reviewDecision: null,
	});

	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [], coordination: undefined });

	const { readForgeLog } = stubForgeOnPath({
		responses: {
			'auth status': { exitCode: 0 },
			'pr list': { stdout: '[]' },
			'pr create': { stdout: 'https://forge.example/acme/repo/pull/41' },
			'pr edit': { exitCode: 0 },
			'pr checks': { stdout: '[{"name":"unit","state":"SUCCESS","bucket":"pass"}]' },
			'pr merge': { exitCode: 0 },
			'pr view': { stdout: viewed },
		},
	});

	return {
		branch,
		cwd,
		readForgeLog,
		params: {
			cwd,
			settings: shipSettingsFixture(),
			integration: shipIntegrationFixture(),
			workOrderGuard: shipTicketGuardFixture(),
			branch,
			defaultBranch: 'main',
			ticket: { ticket: 'lo-89', number: '89' },
			branchDiff: 'diff --git a/feature.md b/feature.md\n',
			recorder: new ShippingProgressRecorder({ cwd, branch, maxAttempts: 1 }),
		},
	};
};

/** The branch this checkout stands on now — `main` once the post-merge cleanup has run, and the feature branch until then. */
const readCurrentBranch = ({ cwd }: { cwd: string }) => execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();

/** The one sentence a ticket record answers when a plan added while the checks ran put the branch outside its approved ship request. */
const refusal = 'plan 003 was added to lo-89 after its ship request, so the ticket no longer authorizes shipping';

/**
 * The same complete candidate, with a ticket guard that authorizes nothing —
 * the ticket whose ship request stopped covering the branch while its checks
 * were running.
 *
 * The recorder is spied on rather than read back from disk, because the merge
 * step's verdict is what this attempt tells its recorder, and the record write
 * is queued behind a promise the attempt never waits for.
 */
const setupRefusedMerge = () => {
	const { branch, params, readForgeLog } = setupAttempt();
	const authorize = jest.fn<ShipWorkOrderGuard['authorize']>();

	authorize.mockResolvedValue(refusal);

	const finishStep = jest.spyOn(params.recorder, 'finishStep');

	return { authorize, branch, finishStep, params: { ...params, workOrderGuard: shipTicketGuardFixture({ authorize }) }, readForgeLog };
};

describe('runShipAttempt', () => {
	test('leaves final persistence and cleanup to the outer ship loop', async () => {
		const { branch, cwd, params } = setupAttempt();

		const attempt = await runShipAttempt(params);

		const currentBranch = readCurrentBranch({ cwd });

		expect(attempt).toEqual(
			expect.objectContaining({
				retryable: false,
				result: expect.objectContaining({
					status: 'shipped',
					branch,
					ticketRef: 'lo-89',
					prNumber: 41,
					prUrl: 'https://forge.example/acme/repo/pull/41',
					prTitle: 'Add the feature',
					mergeCommit: '0f1e2d3c',
				}),
			}),
		);
		await expect(access(join(cwd, '.lightsout', 'tickets', branch, 'ship.json'))).rejects.toThrow();
		expect(currentBranch).toBe(branch);
	});

	test('re-asks the ticket guard before the merge and stops without merging when it refuses', async () => {
		const { authorize, branch, finishStep, params, readForgeLog } = setupRefusedMerge();

		const attempt = await runShipAttempt(params);

		const forgeLog = readForgeLog();

		expect(attempt).toEqual(
			expect.objectContaining({
				retryable: false,
				result: expect.objectContaining({ status: 'blocked', reason: 'ticket-not-authorized', detail: refusal, branch, ticketRef: 'lo-89' }),
			}),
		);
		expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ branch }));
		expect(forgeLog.some((line) => line.startsWith('pr checks'))).toBe(true);
		expect(forgeLog.some((line) => line.startsWith('pr merge'))).toBe(false);
		expect(finishStep).toHaveBeenCalledWith({ step: 'merge', passed: false });
	});
});
