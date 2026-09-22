import { describe, expect, test } from '@jest/globals';
import { commitRunWork } from '#src/commit/index.ts';
import { headSubject } from '#tests/helpers/headSubject.ts';
import { plainSubject, planFolder, planId, setupCommitRun } from '#tests/helpers/setupCommitRun.ts';

// Git stays real, HEAD read included: what these cases pin is the subject a
// commit is addressed under, which is only readable from the commit git made.
describe('commitRunWork subjects', () => {
	test('addresses an unphased plan run by its ticket and plan id', async () => {
		const { cwd, run } = await setupCommitRun({ dirty: { 'src/thing.ts': 'export const thing = 1;\n' }, changedFiles: ['src/thing.ts'], record: 'valid' });

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, subject: headSubject({ cwd }) }).toStrictEqual({
			uncommitted: undefined,
			subject: `LO-152 ${planId}: One commit behaviour`,
		});
	});

	test('addresses a phase run by its plan id and phase file stem', async () => {
		const { cwd, run } = await setupCommitRun({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n' },
			changedFiles: ['src/thing.ts'],
			plan: `${planFolder}/phase2-activity-record.md`,
			record: 'valid',
		});

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, subject: headSubject({ cwd }) }).toStrictEqual({
			uncommitted: undefined,
			subject: `LO-152 ${planId}/phase2-activity-record: One commit behaviour`,
		});
	});

	test('addresses a plan outside the plans directory by its file name', async () => {
		const { cwd, run } = await setupCommitRun({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n', 'notes/idea.md': '# an idea\n' },
			changedFiles: ['src/thing.ts'],
			plan: 'notes/idea.md',
		});

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, subject: headSubject({ cwd }) }).toStrictEqual({ uncommitted: undefined, subject: 'lo-152 idea' });
	});

	test('falls back to the branch name when no ticket names the run', async () => {
		const { cwd, run } = await setupCommitRun({
			branch: 'wip-tree',
			dirty: { 'src/thing.ts': 'export const thing = 1;\n' },
			changedFiles: ['src/thing.ts'],
			plan: `.lightsout/work-orders/wip-tree/plans/${planId}/plan.md`,
		});

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, subject: headSubject({ cwd }) }).toStrictEqual({ uncommitted: undefined, subject: `wip-tree ${planId}` });
	});

	test('names no ticket at all when the checkout stands on no branch', async () => {
		const { cwd, run } = await setupCommitRun({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n' },
			changedFiles: ['src/thing.ts'],
			branchOnManifest: false,
			detached: true,
		});

		const uncommitted = await commitRunWork({ run, resumed: false });

		// The ladder runs out on a detached HEAD, and the unit is still named
		// rather than the commit refused.
		expect({ uncommitted, subject: headSubject({ cwd }) }).toStrictEqual({ uncommitted: undefined, subject: `ticket ${planId}` });
	});

	test('commits under a supplied subject without deriving one', async () => {
		const { cwd, run } = await setupCommitRun({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n' },
			changedFiles: ['src/thing.ts'],
			plan: `${planFolder}/plan.md`,
			record: 'valid',
		});

		const uncommitted = await commitRunWork({ run, subject: 'LO-152 Drain the backlog', resumed: false });

		expect({ uncommitted, subject: headSubject({ cwd }) }).toStrictEqual({ uncommitted: undefined, subject: 'LO-152 Drain the backlog' });
	});

	test('addresses a legacy plan folder by its own name', async () => {
		const { cwd, run } = await setupCommitRun({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n' },
			changedFiles: ['src/thing.ts'],
			plan: '.lightsout/work-orders/legacy-notes/plans/plan.md',
		});

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, subject: headSubject({ cwd }) }).toStrictEqual({ uncommitted: undefined, subject: 'lo-152 legacy-notes' });
	});

	test('commits under the branch reference when the work order state cannot be read', async () => {
		const { cwd, run, progress } = await setupCommitRun({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n' },
			changedFiles: ['src/thing.ts'],
			record: 'corrupt',
		});

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, subject: headSubject({ cwd }), progress }).toEqual({
			uncommitted: undefined,
			subject: plainSubject,
			progress: expect.arrayContaining([expect.stringMatching(/work order state/i)]),
		});
	});
});
