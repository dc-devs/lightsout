import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { resolveMergeConflicts } from '#src/ship/integration/resolveMergeConflicts.ts';
import { report } from '#tests/helpers/report.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';

const branch = 'lo-89-ship';

/** The one file both branches edited, so merging the default branch in has to conflict. */
const conflictPath = 'shared.ts';

const author = '-c user.name=t -c user.email=t@t';

const git = ({ cwd, command }: { cwd: string; command: string }) => execSync(`git ${command}`, { cwd, stdio: 'ignore' });

/** The commit the branch stands on — where a step that must not commit leaves it. */
const readHead = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();

/** What the remote holds for the branch, empty when nothing was ever pushed to it. */
const readRemoteBranch = ({ cwd }: { cwd: string }) => execSync(`git ls-remote --heads origin ${branch}`, { cwd, encoding: 'utf8' }).trim();

/** Write the file the agent was asked to settle, and stage it exactly as the role is allowed to. */
const stageResolution = ({ cwd, content }: { cwd: string; content: string }) => {
	writeFileSync(join(cwd, conflictPath), content);
	git({ cwd, command: `add ${conflictPath}` });
};

/**
 * A feature branch standing in an open, conflicted merge of `origin/main`, with
 * the harness scripted per attempt.
 *
 * Git is real rather than stubbed: what is still unmerged after an attempt is
 * the evidence this step decides on, so a stubbed git would prove nothing.
 */
const setupConflict = ({ onAttempt }: { onAttempt: (params: { cwd: string; attempt: number }) => void }) => {
	const { cwd } = setupBranchRepo({ branch });

	writeFileSync(join(cwd, conflictPath), 'export const value = "feature";\n');
	git({ cwd, command: 'add -A' });
	git({ cwd, command: `${author} commit -qm "the feature edits the shared file"` });
	git({ cwd, command: 'checkout -q main' });
	writeFileSync(join(cwd, conflictPath), 'export const value = "default";\n');
	git({ cwd, command: 'add -A' });
	git({ cwd, command: `${author} commit -qm "the default branch edits the same line"` });
	git({ cwd, command: 'push -q origin main' });
	git({ cwd, command: `checkout -q ${branch}` });
	git({ cwd, command: 'fetch -q origin' });

	try {
		git({ cwd, command: 'merge --no-commit --no-ff origin/main' });
	} catch {
		// The conflict IS the arrangement: git exits non-zero and leaves the merge
		// open, which is the state the caller hands this step.
	}

	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);
			onAttempt({ cwd, attempt: invocations.length });

			return { text: report(), exitCode: 0 };
		},
	};

	return { cwd, invocations, integration: shipIntegrationFixture({ driver }), baseline: readHead({ cwd }) };
};

const resolve = ({ cwd, integration }: { cwd: string; integration: ReturnType<typeof shipIntegrationFixture> }) =>
	resolveMergeConflicts({ cwd, integration, branch, defaultBranch: 'main', conflictPaths: [conflictPath] });

describe('resolveMergeConflicts', () => {
	test('spends the corrective attempt and settles on it', async () => {
		const { cwd, invocations, integration } = setupConflict({
			onAttempt: ({ cwd: repo, attempt }) => {
				if (attempt === 2) {
					stageResolution({ cwd: repo, content: 'export const value = "feature and default";\n' });
				}
			},
		});

		const failure = await resolve({ cwd, integration });

		// nothing is left unmerged, so the recovery succeeded
		expect(failure).toBe(undefined);
		// twice and not once: a first attempt that settled nothing is not the end
		// of the allowance. Twice and not three times: the allowance is bounded.
		expect(invocations.length).toBe(2);
	});

	test("believes git rather than the agent's report about what is still unmerged", async () => {
		const { cwd, invocations, integration } = setupConflict({ onAttempt: () => undefined });

		const failure = await resolve({ cwd, integration });

		// every attempt claimed success and git still lists the path, so the
		// answer is a failure naming that path
		expect(failure).toEqual(expect.objectContaining({ reason: 'integration-conflict', paths: expect.arrayContaining(['shared.ts']) }));
		expect(invocations.length).toBe(2);
	});

	test('turns a harness that will not answer into a bounded failure', async () => {
		const { cwd, invocations, integration } = setupConflict({
			onAttempt: () => {
				throw new Error('the harness could not be reached');
			},
		});

		const failure = await resolve({ cwd, integration });

		// a broken harness is a spent attempt, not an exception the caller has to
		// catch around its own git state
		expect(failure).toEqual(expect.objectContaining({ reason: 'integration-conflict' }));
		expect(invocations.length).toBe(2);
	});

	test('rejects staged unresolved conflict markers despite a complete report', async () => {
		const { cwd, invocations, integration, baseline } = setupConflict({
			onAttempt: ({ cwd: repo }) => {
				stageResolution({
					cwd: repo,
					content: '<<<<<<< HEAD\nexport const value = "feature";\n=======\nexport const value = "default";\n>>>>>>> origin/main\n',
				});
			},
		});

		const failure = await resolve({ cwd, integration });

		// staging a file that still carries the markers is not a resolution, so
		// the first attempt does not end the loop and the step blocks
		expect(failure).toEqual(expect.objectContaining({ reason: 'integration-conflict' }));
		expect(invocations.length).toBe(2);
		// and the unresolved content reached neither a commit nor the remote
		expect(readHead({ cwd })).toBe(baseline);
		expect(readRemoteBranch({ cwd })).toBe('');
	});
});
