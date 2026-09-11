import { execSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { GateRunResult } from '#src/gates/index.ts';
import { ShippingProgressRecorder } from '#src/ship/progress/index.ts';
import { runShipAttempt } from '#src/ship/runShipAttempt.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
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

	stubForgeOnPath({
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
		params: {
			cwd,
			settings: shipSettingsFixture(),
			integration: shipIntegrationFixture(),
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
		await expect(access(join(cwd, '.lightsout', 'ship', `${branch}.json`))).rejects.toThrow();
		expect(currentBranch).toBe(branch);
	});
});
