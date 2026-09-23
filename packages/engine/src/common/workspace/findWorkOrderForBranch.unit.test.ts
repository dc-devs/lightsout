import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { findWorkOrderForBranch } from '#src/common/workspace/findWorkOrderForBranch.ts';

/**
 * A state the contract accepts, written by hand so the look-up is the only
 * thing under test. `branch` is stated apart from `name`, because a work order
 * created from a prefixed `queue.branch-template` stores one that its label
 * does not spell.
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
 * A checkout with no repository above it, holding one work-order folder per
 * record: one whose branch is its own label, and one whose branch carries a
 * prefix the label does not.
 */
const setupCheckout = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-find-work-order-for-branch-'));

	for (const { name, branch } of [
		{ name: 'lo-1-alpha', branch: 'lo-1-alpha' },
		{ name: 'lo-2-beta', branch: 'feature/lo-2-beta' },
	]) {
		const folder = join(cwd, '.lightsout', 'work-orders', name);

		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf({ name, branch })));
	}

	return { cwd };
};

/**
 * A checkout whose work-orders directory holds whatever the caller states: a
 * folder with a record, a folder with none, or a loose file. `records` names
 * the folders that get one, `emptyFolders` the folders that do not, and
 * `looseFile` a file sitting among them.
 */
const setupWorkOrders = ({
	records = [],
	emptyFolders = [],
	looseFile,
}: {
	records?: { name: string; branch: string }[];
	emptyFolders?: string[];
	looseFile?: string;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-find-work-order-for-branch-'));
	const workOrders = join(cwd, '.lightsout', 'work-orders');

	mkdirSync(workOrders, { recursive: true });

	for (const { name, branch } of records) {
		mkdirSync(join(workOrders, name), { recursive: true });
		writeFileSync(join(workOrders, name, 'state.json'), JSON.stringify(workOrderStateOf({ name, branch })));
	}

	for (const name of emptyFolders) {
		mkdirSync(join(workOrders, name), { recursive: true });
	}

	if (looseFile !== undefined) {
		writeFileSync(join(workOrders, looseFile), 'not a work order');
	}

	return { cwd };
};

describe('findWorkOrderForBranch', () => {
	test('finds the work order whose record stores the branch, whatever the branch is prefixed with', async () => {
		const { cwd } = setupCheckout();

		const listing = await findWorkOrderForBranch({ cwd, branch: 'feature/lo-2-beta' });

		expect(listing).toEqual({
			name: 'lo-2-beta',
			record: expect.objectContaining({ name: 'lo-2-beta', branch: 'feature/lo-2-beta' }),
		});
	});

	test('answers undefined for a branch no record claims, and never derives a name from it', async () => {
		const { cwd } = setupCheckout();

		const listing = await findWorkOrderForBranch({ cwd, branch: 'feature/lo-1-alpha' });

		expect(listing).toBeUndefined();
	});

	test('answers undefined in a checkout that has no work-orders directory yet', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-find-work-order-for-branch-'));

		const listing = await findWorkOrderForBranch({ cwd, branch: 'lo-1-alpha' });

		// nothing has been created here, and the look-up reads that as "no work
		// order claims this branch" rather than failing the caller
		expect(listing).toBeUndefined();
	});

	test('skips a folder holding no record and a loose file, and still finds the one record that claims the branch', async () => {
		const { cwd } = setupWorkOrders({
			records: [{ name: 'lo-2-beta', branch: 'feature/lo-2-beta' }],
			emptyFolders: ['lo-0-abandoned'],
			looseFile: 'README.md',
		});

		const listing = await findWorkOrderForBranch({ cwd, branch: 'feature/lo-2-beta' });

		expect(listing).toEqual({ name: 'lo-2-beta', record: expect.objectContaining({ branch: 'feature/lo-2-beta' }) });
	});

	test('answers the first record in sorted order when two of them name one branch, so the answer never changes between reads', async () => {
		const { cwd } = setupWorkOrders({
			records: [
				{ name: 'lo-9-zeta', branch: 'feature/shared' },
				{ name: 'lo-3-gamma', branch: 'feature/shared' },
			],
		});

		const listing = await findWorkOrderForBranch({ cwd, branch: 'feature/shared' });

		// two records naming one branch is a hand-repair case; what this pins is
		// that the look-up answers the same one every time rather than whichever
		// the filesystem listed first
		expect(listing).toEqual({ name: 'lo-3-gamma', record: expect.objectContaining({ name: 'lo-3-gamma' }) });
	});
});
