import { describe, expect, test } from '@jest/globals';
import { readRunCommitAddress } from '#src/commit/common/utils/readRunCommitAddress.ts';
import { PlanProgress, WorkOrderMode } from '#src/contracts/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { configOf, manifestOf } from '#tests/helpers/setupCommitRun.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// The address is imported from its own file rather than the commit barrel,
// which deliberately withholds `readRunCommitAddress` so nothing outside
// `commitRunWork` can commit under an address no run derived.

/** A label carrying no ticket id at all, so the reference in the address can only have come from the record. */
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
 * A real checkout standing on the work order's branch, with the plan folder
 * and, unless `record` is off, the record beside it.
 *
 * Git stays real: what the cases pin is that the record answers first and the
 * branch answers only when no record does, and a stubbed branch read would
 * leave that ladder untested.
 */
const setupAddress = ({ record = true }: { record?: boolean } = {}) => {
	const { cwd } = setupBranchRepo({ branch: workOrderName, workOrder: false });
	const progress: string[] = [];

	writeRepoFile({ cwd, path: `${planFolder}/plan.md`, content: '# One author for a name\n' });

	if (record) {
		writeRepoFile({ cwd, path: `.lightsout/work-orders/${workOrderName}/state.json`, content: recordText });
	}

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

describe('readRunCommitAddress', () => {
	test("readRunCommitAddress: answers the record's ticket reference, the plan unit, the template subject and a reason naming the plan title", async () => {
		const { cwd, manifest, config, onProgress } = setupAddress();

		const address = await readRunCommitAddress({ cwd, manifest, config, onProgress });

		expect(address).toEqual({
			reference: 'LO-158',
			unit: '001-one-author',
			fallbackSubject: 'LO-158 001-one-author: One author for a name',
			context: expect.stringContaining('001-one-author'),
		});
		expect(address.context).toContain('One author for a name');
	});

	test('readRunCommitAddress: falls back to the run label for the reference and leaves the title out when no record names the run', async () => {
		const { cwd, manifest, config, onProgress } = setupAddress({ record: false });

		const address = await readRunCommitAddress({ cwd, manifest, config, onProgress });

		expect(address).toEqual({
			reference: 'naming-the-work',
			unit: '001-one-author',
			fallbackSubject: 'naming-the-work 001-one-author',
			context: expect.stringContaining('001-one-author'),
		});
		expect(address.context).not.toContain('One author for a name');
	});
});
