import { describe, expect, test } from '@jest/globals';
import { readRunCommitSubject } from '#src/commit/common/utils/readRunCommitSubject.ts';
import { PlanProgress, WorkOrderMode } from '#src/contracts/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { configOf, manifestOf } from '#tests/helpers/setupCommitRun.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// The subject is imported from its own file rather than the commit barrel,
// which deliberately withholds it so nothing outside `commitRunWork` can commit
// under a subject no run derived.

/** A label carrying no ticket id at all, so the reference in the subject can only have come from the record. */
const workOrderName = 'naming-the-work';
const planId = '001-one-author';
const planFolder = `.lightsout/work-orders/${workOrderName}/plans/${planId}`;

/** One work order's record on disk: a ticket reference the label does not spell, and the title of the plan being run. */
const recordText = JSON.stringify({
	schemaVersion: 1,
	name: workOrderName,
	branch: workOrderName,
	ticketRef: 'LO-158',
	mode: WorkOrderMode.SinglePlan,
	plans: [{ id: planId, title: 'One author for a name', progress: PlanProgress.Implementing, createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [],
});

/**
 * A real checkout standing on the work order's branch, with the plan folder and
 * the record beside it.
 *
 * Git stays real: what the case pins is that the record answers first, and a
 * stubbed branch read would leave the branch ladder untested as the thing that
 * did NOT answer.
 */
const setupSubject = () => {
	const { cwd } = setupBranchRepo({ branch: workOrderName });
	const progress: string[] = [];

	writeRepoFile({ cwd, path: `${planFolder}/plan.md`, content: '# One author for a name\n' });
	writeRepoFile({ cwd, path: `.lightsout/work-orders/${workOrderName}/state.json`, content: recordText });

	return {
		cwd,
		progress,
		manifest: manifestOf({ plan: `${planFolder}/plan.md`, changedFiles: [], branch: workOrderName }),
		config: configOf({}),
		onProgress: (message: string) => {
			progress.push(message);
		},
	};
};

describe('readRunCommitSubject', () => {
	test("addresses the commit from the work order's record", async () => {
		const { cwd, manifest, config, onProgress } = setupSubject();

		const subject = await readRunCommitSubject({ cwd, manifest, config, onProgress });

		expect(subject).toBe('LO-158 001-one-author: One author for a name');
	});
});
