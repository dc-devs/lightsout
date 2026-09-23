import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ShipBlockReason, ShipStatus } from '#src/contracts/index.ts';
import { readShipResult } from '#src/ship/index.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

const branch = 'lo-52-status';

/** A repo whose ticket folder holds exactly the given file body for this branch. */
const setupShipResult = ({ body }: { body?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ship-result-'));

	seedWorkOrderRecord({ cwd, name: branch });

	if (body !== undefined) {
		writeFileSync(join(cwd, '.lightsout', 'work-orders', branch, 'ship.json'), body, 'utf8');
	}

	return { cwd };
};

/**
 * A primary checkout with a linked worktree cut from it, and one ship result
 * already filed in the primary's ticket folder — the shape an isolated run
 * asks from, where the reader's `cwd` and the record's checkout differ.
 */
const setupLinkedWorktreeShipResult = () => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', branch);

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	seedWorkOrderRecord({ cwd: primary, name: branch });
	writeFileSync(
		join(primary, '.lightsout', 'work-orders', branch, 'ship.json'),
		JSON.stringify({ status: ShipStatus.Shipped, branch, ticketRef: 'lo-52', prNumber: 41, mergeCommit: '0f1e2d3c', failingChecks: [] }),
		'utf8',
	);

	return { primary, worktree };
};

/**
 * A repo whose only work order stores `lo-52-status`, with a stray `ship.json`
 * sitting in a folder named after a DIFFERENT branch — the shape that separates
 * reading the records from reading a folder named after the branch.
 */
const setupUnclaimedBranchShipResult = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ship-result-'));
	const unclaimed = 'lo-99-unclaimed';

	seedWorkOrderRecord({ cwd, name: branch });

	mkdirSync(join(cwd, '.lightsout', 'work-orders', unclaimed), { recursive: true });
	writeFileSync(
		join(cwd, '.lightsout', 'work-orders', unclaimed, 'ship.json'),
		JSON.stringify({ status: ShipStatus.Shipped, branch: unclaimed, prNumber: 7, failingChecks: [] }),
		'utf8',
	);

	return { cwd, unclaimed };
};

describe('readShipResult', () => {
	test('a shipped result reads back with everything the merge recorded', async () => {
		const { cwd } = setupShipResult({
			body: JSON.stringify({ status: ShipStatus.Shipped, branch, ticketRef: 'lo-52', prNumber: 41, mergeCommit: '0f1e2d3c', failingChecks: [] }),
		});

		const result = await readShipResult({ cwd, branch });

		expect(result).toEqual(expect.objectContaining({ status: ShipStatus.Shipped, branch, prNumber: 41 }));
	});

	test('a blocked result reads back too — a ship that ran and stopped is not a ship that never ran', async () => {
		const { cwd } = setupShipResult({
			body: JSON.stringify({ status: ShipStatus.Blocked, branch, reason: ShipBlockReason.ChecksFailed, failingChecks: ['unit'] }),
		});

		const result = await readShipResult({ cwd, branch });

		expect(result).toEqual(expect.objectContaining({ status: ShipStatus.Blocked, reason: ShipBlockReason.ChecksFailed, failingChecks: ['unit'] }));
	});

	test('no file at all reads as undefined — this branch has never been shipped', async () => {
		const { cwd } = setupShipResult();

		expect(await readShipResult({ cwd, branch })).toBeUndefined();
	});

	test('a file that is not JSON reads as undefined rather than throwing at a reader', async () => {
		const { cwd } = setupShipResult({ body: 'not json at all' });

		expect(await readShipResult({ cwd, branch })).toBeUndefined();
	});

	test('a file that parses but fails the contract reads as undefined', async () => {
		const { cwd } = setupShipResult({ body: JSON.stringify({ status: 'half-shipped' }) });

		expect(await readShipResult({ cwd, branch })).toBeUndefined();
	});

	test('a branch whose work order label differs from the branch name is still found', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ship-result-'));

		seedWorkOrderRecord({ cwd, name: 'lo-9-x', branch: 'feature/x' });
		writeFileSync(join(cwd, '.lightsout', 'work-orders', 'lo-9-x', 'ship.json'), JSON.stringify({ status: ShipStatus.Shipped, failingChecks: [] }), 'utf8');

		// the result is filed with the work order's plans, and the reader finds the
		// work order by the branch its record stores
		expect(await readShipResult({ cwd, branch: 'feature/x' })).toEqual(expect.objectContaining({ status: ShipStatus.Shipped }));
	});

	test("readShipResult: reads the primary checkout's record when asked from a linked worktree", async () => {
		const { worktree } = setupLinkedWorktreeShipResult();

		const result = await readShipResult({ cwd: worktree, branch });

		expect(result).toEqual(expect.objectContaining({ status: ShipStatus.Shipped, branch, ticketRef: 'lo-52', prNumber: 41 }));
		// the worktree holds no state directory at all, so a read scoped to it could only answer undefined
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
	});

	test('answers undefined for a branch that keeps no record', async () => {
		const { cwd, unclaimed } = setupUnclaimedBranchShipResult();

		const result = await readShipResult({ cwd, branch: unclaimed });

		expect(result).toBeUndefined();
	});
});
