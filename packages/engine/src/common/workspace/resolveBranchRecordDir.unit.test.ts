import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveBranchRecordDir } from '#src/common/workspace/resolveBranchRecordDir.ts';

/**
 * A state the contract accepts, written by hand so the look-up is the only
 * thing under test. The branch is stated separately from the label, because a
 * prefixed `queue.branch-template` is exactly the case where the two differ.
 */
const workOrderStateOf = ({ name, branch }: { name: string; branch: string }) => ({
	schemaVersion: 1,
	name,
	branch,
	mode: 'multiple-plan',
	plans: [],
	history: [],
});

/**
 * A checkout with no repository above it, holding one work order folder per
 * record, each with the `plans/` folder a real work order keeps beside its
 * record.
 */
const setupCheckout = ({ records }: { records: { name: string; branch: string }[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-branch-record-dir-'));

	for (const { name, branch } of records) {
		const folder = join(cwd, '.lightsout', 'work-orders', name);

		mkdirSync(join(folder, 'plans', '001-first-plan'), { recursive: true });
		writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf({ name, branch })));
	}

	return { cwd };
};

describe('resolveBranchRecordDir', () => {
	test("files a prefixed branch's records in the work order's own folder, beside its plans", async () => {
		const { cwd } = setupCheckout({
			records: [
				{ name: 'lo-1-alpha', branch: 'lo-1-alpha' },
				{ name: 'lo-2-beta', branch: 'feature/lo-2-beta' },
			],
		});

		const recordDir = await resolveBranchRecordDir({ cwd, branch: 'feature/lo-2-beta' });

		// the folder holding the plans, never one named after the branch
		expect({ recordDir, holdsPlans: recordDir !== undefined && existsSync(join(recordDir, 'plans', '001-first-plan')) }).toStrictEqual({
			recordDir: join(cwd, '.lightsout', 'work-orders', 'lo-2-beta'),
			holdsPlans: true,
		});
	});

	test('answers undefined for a branch no work order claims', async () => {
		const { cwd } = setupCheckout({
			records: [
				{ name: 'lo-1-alpha', branch: 'lo-1-alpha' },
				{ name: 'lo-2-beta', branch: 'feature/lo-2-beta' },
			],
		});

		const recordDir = await resolveBranchRecordDir({ cwd, branch: 'feature/lo-3-gamma' });

		expect(recordDir).toBeUndefined();
	});
});
