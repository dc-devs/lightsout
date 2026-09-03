import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { BranchPhase } from '#src/contracts/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';

/** An empty main checkout, and a hand-written record file for the off-contract cases the writer would never produce. */
const setupCheckout = ({ branch, contents }: { branch?: string; contents?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-branch-state-'));

	if (branch !== undefined && contents !== undefined) {
		mkdirSync(join(cwd, '.lightsout', 'branch-state'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'branch-state', `${branch}.json`), contents);
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
});
