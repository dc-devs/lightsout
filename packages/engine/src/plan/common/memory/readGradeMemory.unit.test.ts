import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readGradeMemory } from '#src/plan/common/memory/readGradeMemory.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** One settled memory as a pass leaves it — only the fields a case turns on. */
const memoryText = ({ nextFindingNumber = 3 }: { nextFindingNumber?: number } = {}) =>
	JSON.stringify({
		planName: 'lo-150-planning-observability',
		findings: [],
		nextFindingNumber,
		updatedAt: '2026-02-01T00:00:00.000Z',
	});

/**
 * A repo whose plan folder holds exactly the given record text. Pass no text and
 * the file is never written, which is the case a first grading pass hits.
 */
const setupMemoryRecord = ({ text }: { text?: string } = {}) => {
	const cwd = setupConsumerRepo();
	const name = 'lo-150-planning-observability';
	const dir = planWorkspaceFolder({ cwd: cwd, name: name });

	if (text !== undefined) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'grade-memory.json'), text, 'utf8');
	}

	return { cwd, name, path: join(dir, 'grade-memory.json') };
};

/**
 * A primary checkout holding the plan's memory record, with a linked worktree
 * cut from it — the shape a grading pass runs in once plan data stays in the
 * main checkout whichever tree the command was launched from.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const name = 'lo-150-planning-observability';
	const worktree = join(cwd, '.worktrees', name);

	mkdirSync(planWorkspaceFolder({ cwd: cwd, name: name }), { recursive: true });
	writeFileSync(join(planWorkspaceFolder({ cwd: cwd, name: name }), 'grade-memory.json'), memoryText({ nextFindingNumber: 7 }), 'utf8');
	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { name, worktree };
};

describe('readGradeMemory', () => {
	test('a plan with no record yet reads as no memory at all', async () => {
		const { cwd, name } = setupMemoryRecord();

		const memory = await readGradeMemory({ cwd, name });

		// absence is the normal first-pass path, not a failure: it starts a fresh
		// baseline rather than refusing to grade
		expect(memory).toBeUndefined();
	});

	test('reads back the record the last pass wrote', async () => {
		const { cwd, name } = setupMemoryRecord({ text: memoryText() });

		const memory = await readGradeMemory({ cwd, name });

		expect(memory).toEqual(
			expect.objectContaining({
				planName: 'lo-150-planning-observability',
				findings: [],
				nextFindingNumber: 3,
				updatedAt: '2026-02-01T00:00:00.000Z',
			}),
		);
	});

	test('a record that is not JSON throws, naming the file it could not read', async () => {
		const { cwd, name, path } = setupMemoryRecord({ text: '{ not json at all' });

		// grading on from an unreadable record would either re-open questions a
		// human settled or drop the ones still open and report the plan clean
		await expect(readGradeMemory({ cwd, name })).rejects.toThrow(path);
	});

	test('a record that is JSON but not a grade memory throws, naming the file', async () => {
		const { cwd, name, path } = setupMemoryRecord({ text: JSON.stringify({ planName: 'lo-150-planning-observability' }) });

		await expect(readGradeMemory({ cwd, name })).rejects.toThrow(path);
	});

	test('a record held by the primary checkout is read from inside a linked worktree', async () => {
		const { name, worktree } = setupLinkedWorktree();

		const memory = await readGradeMemory({ cwd: worktree, name });

		// the worktree holds no plans directory of its own, so reading against it
		// would answer undefined and silently discard every settled finding
		expect(memory).toEqual(expect.objectContaining({ planName: name, nextFindingNumber: 7 }));
	});
});
