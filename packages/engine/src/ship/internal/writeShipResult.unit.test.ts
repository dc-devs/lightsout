import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ShipResult } from '#src/contracts/ship/ShipResult.ts';
import { writeShipResult } from '#src/ship/internal/writeShipResult.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A repo holding one work order's record and nowhere to write yet — the directory is the writer's job to create. */
const setupResultWrite = async ({ branch = 'lo-60-ship' }: { branch?: string } = {}) => {
	const cwd = await freshCwd();

	seedWorkOrderRecord({ cwd, name: 'lo-60-ship', branch, ticketRef: 'lo-60' });

	const result = ShipResult.parse({ status: 'blocked', reason: 'checks-failed', detail: 'unit finished red', failingChecks: ['unit'], branch });

	return { cwd, result };
};

/**
 * A primary checkout with a linked worktree cut from it, standing on a
 * slash-bearing branch — the shape an isolated ship runs in, and the one where
 * the record's directory and the caller's `cwd` are two different checkouts.
 */
const setupLinkedShipWrite = ({ branch = 'feature/lo-60' }: { branch?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-60-ship');

	seedWorkOrderRecord({ cwd, name: 'lo-60-ship', branch, ticketRef: 'lo-60' });
	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd, stdio: 'ignore' });

	const result = ShipResult.parse({ status: 'shipped', branch, ticketRef: 'lo-60', prNumber: 60, mergeCommit: '0f1e2d3c', failingChecks: [] });

	return { branch, primary: cwd, worktree, result };
};

/**
 * A checkout holding one work order whose record stores a prefixed branch, and
 * two results: one for that branch, one for a branch no record claims.
 */
const setupWorkOrderShipWrite = async () => {
	const cwd = await freshCwd();
	const folder = join(cwd, '.lightsout', 'work-orders', 'lo-60-ship');

	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, 'state.json'),
		JSON.stringify({ schemaVersion: 1, name: 'lo-60-ship', branch: 'feature/lo-60', ticketRef: 'lo-60', mode: 'multiple-plan', plans: [], history: [] }),
	);

	const claimed = ShipResult.parse({
		status: 'shipped',
		branch: 'feature/lo-60',
		ticketRef: 'lo-60',
		prNumber: 60,
		mergeCommit: '0f1e2d3c',
		failingChecks: [],
	});
	const unclaimed = ShipResult.parse({
		status: 'shipped',
		branch: 'lo-99-nobody',
		ticketRef: 'lo-99',
		prNumber: 99,
		mergeCommit: '9a8b7c6d',
		failingChecks: [],
	});

	return { cwd, claimed, unclaimed };
};

describe('writeShipResult', () => {
	test("writeShipResult: files a branch's result as ship.json in its work order's own folder", async () => {
		const { cwd, result } = await setupResultWrite();

		const resultPath = await writeShipResult({ cwd, result });

		expectDefined(resultPath);
		expect(resultPath).toBe(join(cwd, '.lightsout', 'work-orders', 'lo-60-ship', 'ship.json'));
		expect(JSON.parse(await readFile(resultPath, 'utf8'))).toStrictEqual(result);
		expect(existsSync(join(cwd, '.lightsout', 'ship'))).toBe(false);
	});

	test('writeShipResult: a result written from a linked worktree lands in the primary checkout', async () => {
		const { primary, worktree, result } = setupLinkedShipWrite();

		const resultPath = await writeShipResult({ cwd: worktree, result });

		expectDefined(resultPath);
		expect(JSON.parse(await readFile(join(primary, '.lightsout', 'work-orders', 'lo-60-ship', 'ship.json'), 'utf8'))).toStrictEqual(result);
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
		expect(resultPath.startsWith(worktree)).toBe(false);
	});

	test("a result whose branch git never named is filed nowhere, because no work order's record can store one", async () => {
		const cwd = await freshCwd();
		const result = ShipResult.parse({ status: 'blocked', reason: 'checks-failed', detail: 'unit finished red', failingChecks: ['unit'] });

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBeUndefined();
		expect(existsSync(join(cwd, '.lightsout', 'work-orders'))).toBe(false);
	});

	test('leaves no temp file behind, because a tracker skill reading the directory would find two answers', async () => {
		const { cwd, result } = await setupResultWrite();

		const resultPath = await writeShipResult({ cwd, result });

		expectDefined(resultPath);
		await expect(readFile(`${resultPath}.tmp`, 'utf8')).rejects.toThrow();
	});

	test("files a result with the work order's plans, and writes none for a branch no work order claims", async () => {
		const { cwd, claimed, unclaimed } = await setupWorkOrderShipWrite();

		const claimedPath = await writeShipResult({ cwd, result: claimed });
		const unclaimedPath = await writeShipResult({ cwd, result: unclaimed });

		expect(claimedPath).toBe(join(cwd, '.lightsout', 'work-orders', 'lo-60-ship', 'ship.json'));
		expect(JSON.parse(await readFile(join(cwd, '.lightsout', 'work-orders', 'lo-60-ship', 'ship.json'), 'utf8'))).toStrictEqual(claimed);
		expect(unclaimedPath).toBeUndefined();
		expect(readdirSync(join(cwd, '.lightsout', 'work-orders'))).toStrictEqual(['lo-60-ship']);
	});
});
