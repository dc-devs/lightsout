import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/records/index.ts';

/** An empty checkout, plus hand-written record files by branch for the off-contract cases the writer would never produce. */
const setupCheckout = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));

	for (const [branch, contents] of Object.entries(files)) {
		mkdirSync(join(cwd, '.lightsout', 'worktrees'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'worktrees', `${branch}.json`), contents);
	}

	return { cwd };
};

describe('readWorktreeRecord', () => {
	test('reads back a written record, and answers undefined for a missing or malformed one', async () => {
		const { cwd } = setupCheckout({
			files: {
				'lo-7-malformed': '{ this is not json',
				// Valid JSON that the contract still refuses: an owner neither member
				// of `WorktreeOwner` holds, which is what an older or newer engine
				// could have written.
				'lo-7-off-contract': JSON.stringify({
					branch: 'lo-7-off-contract',
					owner: 'refactor',
					worktreePath: '/tmp/lightsout-worktrees/lo-7-off-contract',
					createdAt: '2026-01-01T00:00:00.000Z',
				}),
			},
		});

		await writeWorktreeRecord({
			cwd,
			branch: 'lo-7-isolate',
			owner: WorktreeOwner.Implement,
			worktreePath: '/tmp/lightsout-worktrees/lo-7-isolate',
		});

		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-isolate' })).toEqual(
			expect.objectContaining({
				branch: 'lo-7-isolate',
				owner: 'implement',
				worktreePath: '/tmp/lightsout-worktrees/lo-7-isolate',
			}),
		);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-unrecorded' })).toBe(undefined);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-malformed' })).toBe(undefined);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-off-contract' })).toBe(undefined);
	});
});
