import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { GradeMemory } from '#src/contracts/index.ts';
import { writeGradeMemory } from '#src/plan/common/memory/writeGradeMemory.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** One pass's memory, carrying only the fields a case turns on. */
const memoryOf = ({ name, nextFindingNumber = 4 }: { name: string; nextFindingNumber?: number }): GradeMemory => ({
	planName: name,
	findings: [],
	coverage: { readers: [] },
	nextFindingNumber,
	updatedAt: '2026-02-01T00:00:00.000Z',
});

/** A repo whose plan folder already exists — the state every detection pass leaves before a grade is written. */
const setupPlanFolder = () => {
	const cwd = setupConsumerRepo();
	const name = 'lo-150-planning-observability';
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });

	return { cwd, name, dir };
};

/**
 * A primary checkout holding the plan folder, with a linked worktree cut from
 * it — the shape a grading pass runs in when `plan.worktree` moved the session
 * into a tree that will be removed once its work ships.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const name = 'lo-150-planning-observability';
	const worktree = join(cwd, '.worktrees', name);

	mkdirSync(join(cwd, '.lightsout', 'plans', name), { recursive: true });
	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, name, worktree };
};

describe('writeGradeMemory', () => {
	test('writes the record into the plan folder, named grade-memory.json', async () => {
		const { cwd, name } = setupPlanFolder();

		await writeGradeMemory({ cwd, name, memory: memoryOf({ name }) });

		// the spelled-out path rather than the helper's own answer: a memory written
		// anywhere else is one the next pass reads as a plan never graded
		const written = readFileSync(join(cwd, '.lightsout', 'plans', name, 'grade-memory.json'), 'utf8');

		expect(JSON.parse(written)).toEqual(expect.objectContaining({ planName: name, findings: [], nextFindingNumber: 4, updatedAt: '2026-02-01T00:00:00.000Z' }));
	});

	test('a memory its own contract rejects never reaches disk', async () => {
		const { cwd, name, dir } = setupPlanFolder();
		const malformed = { ...memoryOf({ name }), nextFindingNumber: 'four' } as unknown as GradeMemory;

		await expect(writeGradeMemory({ cwd, name, memory: malformed })).rejects.toThrow();

		// a record the reader would refuse is worse than none: the next pass would
		// throw rather than start a fresh baseline
		expect(existsSync(join(dir, 'grade-memory.json'))).toBe(false);
	});

	test("a memory written from a linked worktree lands in the primary checkout's plan folder", async () => {
		const { primary, name, worktree } = setupLinkedWorktree();

		await writeGradeMemory({ cwd: worktree, name, memory: memoryOf({ name, nextFindingNumber: 9 }) });

		// written into the tree, the record would die with the tree — so the primary
		// holds it and the worktree gets no plans directory at all
		expect({
			primary: JSON.parse(readFileSync(join(primary, '.lightsout', 'plans', name, 'grade-memory.json'), 'utf8')),
			worktreeHasPlans: existsSync(join(worktree, '.lightsout')),
		}).toStrictEqual({
			primary: { planName: name, findings: [], coverage: { readers: [] }, nextFindingNumber: 9, updatedAt: '2026-02-01T00:00:00.000Z' },
			worktreeHasPlans: false,
		});
	});
});
