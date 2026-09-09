import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { repairCiFailure } from '#src/ship/integration/repairCiFailure.ts';
import { report } from '#tests/helpers/report.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';

/** The commit the branch stands on — where a step that must not commit leaves it. */
const readHead = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();

/** Uncommitted paths, empty when the tree is clean. */
const readDirtyPaths = ({ cwd }: { cwd: string }) => execSync('git status --porcelain', { cwd, encoding: 'utf8' }).trim();

/** What the remote holds for a branch, empty when nothing was ever pushed to it. */
const readRemoteBranch = ({ cwd, branch }: { cwd: string; branch: string }) =>
	execSync(`git ls-remote --heads origin ${branch}`, { cwd, encoding: 'utf8' }).trim();

/** Everything one spawn was handed — the cached role half and the per-attempt half together. */
const textOf = ({ invocation }: { invocation?: DriverInvocation }) => `${invocation?.systemPrompt ?? ''}\n${invocation?.prompt ?? ''}`;

/**
 * A CI repair on a real feature branch, with the harness scripted to answer one
 * fixed final message — the report's own status is what decides the outcome.
 */
const setupRepair = ({ text }: { text: string }) => {
	const branch = 'lo-89-ship';
	const invocations: DriverInvocation[] = [];
	const { cwd } = setupBranchRepo({ branch });
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text, exitCode: 0 };
		},
	};

	return { branch, cwd, invocations, integration: shipIntegrationFixture({ driver }), baseline: readHead({ cwd }) };
};

describe('repairCiFailure', () => {
	test('forwards CI scope and blocks a repair that cannot complete', async () => {
		const { branch, cwd, invocations, integration, baseline } = setupRepair({
			text: report({ status: 'failed', summary: 'no in-scope repair', failures: ['the failing job cannot be traced to this candidate'] }),
		});

		const failure = await repairCiFailure({
			cwd,
			integration,
			branch,
			defaultBranch: 'main',
			ticketRef: 'LO-89-TICKET-SENTINEL',
			branchDiff: 'BRANCH-DIFF-SENTINEL',
			ciEvidence: 'CI-EVIDENCE-SENTINEL',
		});

		// a report that did not complete is a blocked CI repair, carrying what the
		// agent said it could not do
		expect(failure).toEqual(expect.objectContaining({ reason: 'checks-failed', detail: expect.stringContaining('cannot be traced to this candidate') }));
		// one spawn only — this step owns neither retries nor a second opinion
		expect(invocations.length).toBe(1);
		// the original candidate intent rides along with the evidence, so the
		// repair is scoped by what the branch set out to do
		expect(textOf({ invocation: invocations[0] })).toContain('LO-89-TICKET-SENTINEL');
		expect(textOf({ invocation: invocations[0] })).toContain('BRANCH-DIFF-SENTINEL');
		expect(textOf({ invocation: invocations[0] })).toContain('CI-EVIDENCE-SENTINEL');
		// nothing committed and nothing on the remote: the parent transaction owns
		// every git state transition
		expect(readHead({ cwd })).toBe(baseline);
		expect(readDirtyPaths({ cwd })).toBe('');
		expect(readRemoteBranch({ cwd, branch })).toBe('');
	});
});
