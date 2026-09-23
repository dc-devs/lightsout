import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { BranchPhase } from '#src/contracts/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A record the work order contract accepts, written by hand so the branch
 * look-up is the only thing under test. The label and the branch are stored
 * separately, because a prefixed branch is exactly where the two differ.
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
 * A checkout holding the work order that claims `lo-70-drain`, and a
 * hand-written phase file beside its record for the off-contract cases the
 * writer would never produce.
 */
const setupCheckout = ({ branch, contents }: { branch?: string; contents?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-branch-state-'));
	const folder = join(cwd, '.lightsout', 'work-orders', 'lo-70-drain');

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf({ name: 'lo-70-drain', branch: 'lo-70-drain' })));

	if (branch !== undefined && contents !== undefined) {
		writeFileSync(join(cwd, '.lightsout', 'work-orders', branch, 'branch-state.json'), contents);
	}

	return { cwd };
};

/**
 * A primary checkout with a second checkout of the same repository cut beside
 * it — the shape a queue lane records from, where the reader's `cwd` and the
 * checkout holding the record are two different directories.
 */
const setupLinkedCheckout = ({ branch = 'lo-70-drain' }: { branch?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-70-drain');
	const folder = join(cwd, '.lightsout', 'work-orders', 'lo-70-drain');

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd, stdio: 'ignore' });
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf({ name: 'lo-70-drain', branch })));

	return { branch, primary: cwd, worktree };
};

/**
 * A checkout holding one work order folder per record, and optionally a folder
 * named after a branch no record claims — holding the very `branch-state.json`
 * the old branch-named route would have read.
 */
const setupWorkOrders = ({ records, strayBranch }: { records: { name: string; branch: string }[]; strayBranch?: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-branch-state-'));

	for (const { name, branch } of records) {
		const folder = join(cwd, '.lightsout', 'work-orders', name);

		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf({ name, branch })));
	}

	if (strayBranch !== undefined) {
		const folder = join(cwd, '.lightsout', 'work-orders', strayBranch);

		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'branch-state.json'), JSON.stringify({ branch: strayBranch, phase: BranchPhase.Ready, updatedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { cwd };
};

describe('readBranchState', () => {
	test('reads back the phase the writer recorded, which is the whole point of the file', async () => {
		const { cwd } = setupCheckout();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Ready });

		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual({
			branch: 'lo-70-drain',
			phase: BranchPhase.Ready,
			updatedAt: expect.any(String),
		});
	});

	test('answers undefined for a branch nobody has recorded, so the caller decides what an unrecorded branch means', async () => {
		const { cwd } = setupCheckout();

		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
	});

	test('answers undefined for a file that is not JSON at all, rather than throwing across the seam', async () => {
		const { cwd } = setupCheckout({ branch: 'lo-70-drain', contents: '{ this is not json' });

		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
	});

	test('answers undefined for valid JSON that carries a phase the vocabulary does not hold', async () => {
		const { cwd } = setupCheckout({
			branch: 'lo-70-drain',
			contents: JSON.stringify({ branch: 'lo-70-drain', phase: 'shipping', updatedAt: '2026-01-01T00:00:00.000Z' }),
		});

		// A phase nothing in the queue can act on is no more usable than a missing
		// file, and reporting it as one keeps every caller on one path.
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
	});

	test('answers undefined for valid JSON missing a field the contract requires', async () => {
		const { cwd } = setupCheckout({ branch: 'lo-70-drain', contents: JSON.stringify({ phase: BranchPhase.Merged }) });

		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
	});

	test('readBranchState: reads a phase recorded from another checkout of the same repository', async () => {
		const { branch, primary, worktree } = setupLinkedCheckout();

		await writeBranchState({ cwd: primary, branch, phase: BranchPhase.Ready });

		// The second checkout keeps no state folder of its own, so a read scoped to
		// it rather than to the repository would have nothing at all to answer with.
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
		expect(await readBranchState({ cwd: worktree, branch })).toEqual({
			branch: 'lo-70-drain',
			phase: BranchPhase.Ready,
			updatedAt: expect.any(String),
		});
	});

	test('answers undefined when no work order claims the branch', async () => {
		const { cwd } = setupWorkOrders({ records: [{ name: 'lo-2-beta', branch: 'feature/lo-2-beta' }], strayBranch: 'lo-9-unclaimed' });

		// The stray folder holds a perfectly readable record under the branch's own
		// name, so an answer of undefined can only mean the reader asked the work
		// orders which one claims the branch rather than reading a file named after it.
		expect(await readBranchState({ cwd, branch: 'lo-9-unclaimed' })).toBe(undefined);
	});
});
