import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { ShipResult } from '#src/contracts/index.ts';
import { writeShipResult } from '#src/ship/writeShipResult.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A repo with nowhere to write yet — the directory is the writer's job to create. */
const setupResultWrite = async ({ branch }: { branch?: string } = {}) => {
	const cwd = await freshCwd();
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

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd, stdio: 'ignore' });

	const result = ShipResult.parse({ status: 'shipped', branch, ticketRef: 'lo-60', prNumber: 60, mergeCommit: '0f1e2d3c', failingChecks: [] });

	return { branch, primary: cwd, worktree, result };
};

describe('writeShipResult', () => {
	test("writeShipResult: files a branch's result as ship.json in that branch's ticket folder", async () => {
		const { cwd, result } = await setupResultWrite({ branch: 'lo-60-ship' });

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBe(join(cwd, '.lightsout', 'tickets', 'lo-60-ship', 'ship.json'));
		expect(JSON.parse(await readFile(resultPath, 'utf8'))).toStrictEqual(result);
		expect(existsSync(join(cwd, '.lightsout', 'ship'))).toBe(false);
	});

	test('writeShipResult: a result written from a linked worktree lands in the primary checkout', async () => {
		const { primary, worktree, result } = setupLinkedShipWrite();

		const resultPath = await writeShipResult({ cwd: worktree, result });

		expect(JSON.parse(await readFile(join(primary, '.lightsout', 'tickets', 'feature-lo-60', 'ship.json'), 'utf8'))).toStrictEqual(result);
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
		expect(resultPath.startsWith(worktree)).toBe(false);
	});

	test('writeShipResult: a slash-bearing branch files one flat ticket folder, never a nested one', async () => {
		const { cwd, result } = await setupResultWrite({ branch: 'feature/lo-60' });

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBe(join(cwd, '.lightsout', 'tickets', 'feature-lo-60', 'ship.json'));
		expect(readdirSync(join(cwd, '.lightsout', 'tickets'))).toStrictEqual(['feature-lo-60']);
	});

	test('files the result under the branch it describes, creating the directory on the way', async () => {
		const { cwd, result } = await setupResultWrite({ branch: 'lo-60-ship' });

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBe(join(cwd, '.lightsout', 'tickets', 'lo-60-ship', 'ship.json'));
		expect(JSON.parse(await readFile(resultPath, 'utf8'))).toStrictEqual(result);
	});

	test('slugs a branch carrying a slash, so a feature branch never writes into a directory of its own', async () => {
		const { cwd, result } = await setupResultWrite({ branch: 'feature/lo-60' });

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBe(join(cwd, '.lightsout', 'tickets', 'feature-lo-60', 'ship.json'));
	});

	test('a result with no branch is filed under `unknown`, so even a run that never learned one leaves a record', async () => {
		const { cwd, result } = await setupResultWrite();

		const resultPath = await writeShipResult({ cwd, result });

		expect(resultPath).toBe(join(cwd, '.lightsout', 'tickets', 'unknown', 'ship.json'));
	});

	test('leaves no temp file behind, because a tracker skill reading the directory would find two answers', async () => {
		const { cwd, result } = await setupResultWrite({ branch: 'lo-60-ship' });

		const resultPath = await writeShipResult({ cwd, result });

		await expect(readFile(`${resultPath}.tmp`, 'utf8')).rejects.toThrow();
	});
});
