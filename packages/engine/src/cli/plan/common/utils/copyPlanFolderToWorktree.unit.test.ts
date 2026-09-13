import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { copyPlanFolderToWorktree } from '#src/cli/plan/common/utils/copyPlanFolderToWorktree.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const name = 'lo-131-concurrent-source-edits-invalidate';
const planFolderPath = join('.lightsout', 'plans', name);
const notesBody = '# brainstorm notes\n\nplanning runs in its own worktree\n';
const decisionsBody = '{"decisions":[{"question":"where does planning run?","choice":"its own worktree"}]}\n';
const gradedPlanBody = '# Planning runs in its own worktree\n\nthe graded, repaired plan\n';
const gradeMemoryBody = '{"grade":"A","pass":3}\n';
const stalePlanBody = '# Planning runs in its own worktree\n\nan older draft left in the launching checkout\n';

const ticketBranch = 'lo-7-search';
const laterPlanAddress = `${ticketBranch}/002-ranking`;
const earlierPlanAddress = `${ticketBranch}/001-basics`;
const ticketFolderPath = join('.lightsout', 'plans', ticketBranch);
const rankingPlanBody = '# Ranking\n\nthe later plan of this ticket\n';
const basicsPlanBody = '# Search basics\n\nthe earlier plan, already in the tree\n';
const ticketRecordBody = '{"schemaVersion":1,"ticketRef":"LO-7","branch":"lo-7-search"}\n';

/** Write each named file into the plan folder under `cwd`. */
const writePlanFolder = ({ cwd, files }: { cwd: string; files: Record<string, string> }) => {
	const planDir = join(cwd, planFolderPath);

	mkdirSync(planDir, { recursive: true });

	for (const [fileName, body] of Object.entries(files)) {
		writeFileSync(join(planDir, fileName), body);
	}

	return planDir;
};

/**
 * A launching checkout holding a plan folder, beside a planning worktree.
 *
 * `worktreeFiles` stocks the worktree with a plan folder of its own first — a
 * resumed session whose tree already holds the graded plan.
 */
const setupPlanFolders = async ({ sourceFiles, worktreeFiles }: { sourceFiles: Record<string, string>; worktreeFiles?: Record<string, string> }) => {
	const sourceCwd = await freshCwd();
	const worktree = await freshCwd();
	const sourcePlanDir = writePlanFolder({ cwd: sourceCwd, files: sourceFiles });

	if (worktreeFiles !== undefined) {
		writePlanFolder({ cwd: worktree, files: worktreeFiles });
	}

	return { sourceCwd, worktree, sourcePlanDir, worktreePlanDir: join(worktree, planFolderPath) };
};

/**
 * A launching checkout holding one ticket folder with the later plan's folder
 * and the ticket record, beside a worktree already holding the earlier plan.
 */
const setupTicketPlanFolders = async () => {
	const sourceCwd = await freshCwd();
	const worktree = await freshCwd();
	const sourceTicketDir = join(sourceCwd, ticketFolderPath);
	const worktreeTicketDir = join(worktree, ticketFolderPath);

	mkdirSync(join(sourceTicketDir, '002-ranking'), { recursive: true });
	writeFileSync(join(sourceTicketDir, '002-ranking', 'plan.md'), rankingPlanBody);
	writeFileSync(join(sourceTicketDir, 'ticket.json'), ticketRecordBody);
	mkdirSync(join(worktreeTicketDir, '001-basics'), { recursive: true });
	writeFileSync(join(worktreeTicketDir, '001-basics', 'plan.md'), basicsPlanBody);

	return { sourceCwd, worktree, worktreeTicketDir };
};

describe('copyPlanFolderToWorktree', () => {
	test("copies the launching checkout's plan folder into a fresh worktree and leaves the original where it is", async () => {
		const { sourceCwd, worktree, sourcePlanDir, worktreePlanDir } = await setupPlanFolders({
			sourceFiles: { 'brainstorm-notes.md': notesBody, 'brainstorm-decisions.json': decisionsBody },
		});

		const result = await copyPlanFolderToWorktree({ sourceCwd, worktree, name });

		expect(result).toBeUndefined();
		expect(readdirSync(worktreePlanDir).sort()).toStrictEqual(['brainstorm-decisions.json', 'brainstorm-notes.md']);
		expect(readFileSync(join(worktreePlanDir, 'brainstorm-notes.md'), 'utf8')).toBe(notesBody);
		expect(readFileSync(join(worktreePlanDir, 'brainstorm-decisions.json'), 'utf8')).toBe(decisionsBody);
		expect(readdirSync(sourcePlanDir).sort()).toStrictEqual(['brainstorm-decisions.json', 'brainstorm-notes.md']);
		expect(readFileSync(join(sourcePlanDir, 'brainstorm-notes.md'), 'utf8')).toBe(notesBody);
		expect(readFileSync(join(sourcePlanDir, 'brainstorm-decisions.json'), 'utf8')).toBe(decisionsBody);
	});

	test('never overwrites a plan folder the worktree already holds', async () => {
		const { sourceCwd, worktree, worktreePlanDir } = await setupPlanFolders({
			sourceFiles: { 'plan.md': stalePlanBody, 'brainstorm-notes.md': notesBody },
			worktreeFiles: { 'plan.md': gradedPlanBody, 'grade-memory.json': gradeMemoryBody },
		});

		const result = await copyPlanFolderToWorktree({ sourceCwd, worktree, name });

		expect(result).toBeUndefined();
		expect(readdirSync(worktreePlanDir).sort()).toStrictEqual(['grade-memory.json', 'plan.md']);
		expect(readFileSync(join(worktreePlanDir, 'plan.md'), 'utf8')).toBe(gradedPlanBody);
		expect(readFileSync(join(worktreePlanDir, 'grade-memory.json'), 'utf8')).toBe(gradeMemoryBody);
	});

	test("copies a later plan's folder into a tree that already holds an earlier plan of the same ticket", async () => {
		const { sourceCwd, worktree, worktreeTicketDir } = await setupTicketPlanFolders();

		const result = await copyPlanFolderToWorktree({ sourceCwd, worktree, name: laterPlanAddress });

		expect(result).toBeUndefined();
		expect(readdirSync(worktreeTicketDir).sort()).toStrictEqual(['001-basics', '002-ranking']);
		expect(readFileSync(join(worktree, '.lightsout', 'plans', laterPlanAddress, 'plan.md'), 'utf8')).toBe(rankingPlanBody);
		expect(readFileSync(join(worktree, '.lightsout', 'plans', earlierPlanAddress, 'plan.md'), 'utf8')).toBe(basicsPlanBody);
		expect(readdirSync(join(worktree, '.lightsout', 'plans', earlierPlanAddress)).sort()).toStrictEqual(['plan.md']);
	});
});
