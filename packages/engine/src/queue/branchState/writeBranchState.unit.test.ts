import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { BranchPhase } from '#src/contracts/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';

const setupCheckout = () => ({ cwd: mkdtempSync(join(tmpdir(), 'lightsout-branch-state-')) });

describe('writeBranchState', () => {
	test('files a slash-bearing branch under one slugged ticket folder, so no branch template nests a directory', async () => {
		const { cwd } = setupCheckout();

		await writeBranchState({ cwd, branch: 'feature/lo-70-drain', phase: BranchPhase.Building });

		expect(readdirSync(join(cwd, '.lightsout', 'tickets'))).toStrictEqual(['feature-lo-70-drain']);
		expect(await readBranchState({ cwd, branch: 'feature/lo-70-drain' })).toEqual(expect.objectContaining({ branch: 'feature/lo-70-drain' }));
	});

	test('leaves no temporary file behind, because the write lands by rename rather than in place', async () => {
		const { cwd } = setupCheckout();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Building });

		expect(readdirSync(join(cwd, '.lightsout', 'tickets', 'lo-70-drain'))).toStrictEqual(['branch-state.json']);
	});

	test('replaces the phase on a second write, since the record is where the branch stands now', async () => {
		const { cwd } = setupCheckout();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Building });
		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Merged });

		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
	});

	test('reports a write it could not make and resolves anyway, rather than failing the run holding the outcome', async () => {
		const { cwd } = setupCheckout();
		const progress: string[] = [];

		// A file where the record directory needs to be: the mkdir cannot succeed,
		// which is the same shape as any other refused write.
		writeFileSync(join(cwd, '.lightsout'), 'not a directory\n');

		await expect(writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Ready, onProgress: (message) => progress.push(message) })).resolves.toBe(
			undefined,
		);

		expect(progress).toEqual([expect.stringContaining("the branch state for lo-70-drain could not be recorded as 'ready'")]);
		expect(existsSync(join(cwd, '.lightsout', 'tickets'))).toBe(false);
	});

	test("writeBranchState: records a branch's phase as branch-state.json in its ticket folder", async () => {
		const { cwd } = setupCheckout();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Building });

		expect(readdirSync(join(cwd, '.lightsout', 'tickets', 'lo-70-drain'))).toStrictEqual(['branch-state.json']);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ branch: 'lo-70-drain', phase: BranchPhase.Building }));
		expect(existsSync(join(cwd, '.lightsout', 'branch-state'))).toBe(false);
	});
});
