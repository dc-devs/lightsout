import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { BranchPhase } from '#src/contracts/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';

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

/** A checkout holding one work order folder per record, each record naming the branch its plans implement on. */
const setupWorkOrders = ({ records }: { records: { name: string; branch: string }[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-branch-state-'));

	for (const { name, branch } of records) {
		const folder = join(cwd, '.lightsout', 'work-orders', name);

		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'state.json'), JSON.stringify(workOrderStateOf({ name, branch })));
	}

	return { cwd };
};

/** A checkout holding one work order that claims `lo-70-drain` — the branch every case below records a phase for. */
const setupCheckout = () => setupWorkOrders({ records: [{ name: 'lo-70-drain', branch: 'lo-70-drain' }] });

describe('writeBranchState', () => {
	test('leaves no temporary file behind, because the write lands by rename rather than in place', async () => {
		const { cwd } = setupCheckout();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Building });

		expect(readdirSync(join(cwd, '.lightsout', 'work-orders', 'lo-70-drain')).sort()).toStrictEqual(['branch-state.json', 'state.json']);
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

		// A directory where the temporary file needs to be: the write cannot
		// succeed, which is the same shape as any other refused write.
		mkdirSync(join(cwd, '.lightsout', 'work-orders', 'lo-70-drain', 'branch-state.json.tmp'), { recursive: true });

		await expect(writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Ready, onProgress: (message) => progress.push(message) })).resolves.toBe(
			undefined,
		);

		expect(progress).toEqual([expect.stringContaining("the branch state for lo-70-drain could not be recorded as 'ready'")]);
		expect(existsSync(join(cwd, '.lightsout', 'work-orders', 'lo-70-drain', 'branch-state.json'))).toBe(false);
	});

	test("writeBranchState: records a branch's phase as branch-state.json in its work order's folder", async () => {
		const { cwd } = setupCheckout();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Building });

		expect(readdirSync(join(cwd, '.lightsout', 'work-orders', 'lo-70-drain')).sort()).toStrictEqual(['branch-state.json', 'state.json']);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ branch: 'lo-70-drain', phase: BranchPhase.Building }));
		expect(existsSync(join(cwd, '.lightsout', 'branch-state'))).toBe(false);
	});

	test("writes a prefixed branch's phase into the work order's own folder", async () => {
		const { cwd } = setupWorkOrders({ records: [{ name: 'lo-2-beta', branch: 'feature/lo-2-beta' }] });

		await writeBranchState({ cwd, branch: 'feature/lo-2-beta', phase: BranchPhase.Building });

		expect(readdirSync(join(cwd, '.lightsout', 'work-orders'))).toStrictEqual(['lo-2-beta']);
		expect(readdirSync(join(cwd, '.lightsout', 'work-orders', 'lo-2-beta')).sort()).toStrictEqual(['branch-state.json', 'state.json']);
		expect(await readBranchState({ cwd, branch: 'feature/lo-2-beta' })).toEqual(
			expect.objectContaining({ branch: 'feature/lo-2-beta', phase: BranchPhase.Building }),
		);
	});

	test('writes nothing and says so when no work order claims the branch', async () => {
		const { cwd } = setupWorkOrders({ records: [{ name: 'lo-2-beta', branch: 'feature/lo-2-beta' }] });
		const progress: string[] = [];

		await expect(writeBranchState({ cwd, branch: 'lo-9-unclaimed', phase: BranchPhase.Ready, onProgress: (message) => progress.push(message) })).resolves.toBe(
			undefined,
		);

		expect(readdirSync(join(cwd, '.lightsout', 'work-orders'))).toStrictEqual(['lo-2-beta']);
		expect(readdirSync(join(cwd, '.lightsout', 'work-orders', 'lo-2-beta'))).toStrictEqual(['state.json']);
		expect(progress).toHaveLength(1);
		expect(progress[0]).toEqual(expect.stringContaining('lo-9-unclaimed'));
		expect(progress[0]).toEqual(expect.stringContaining('ready'));
	});
});
