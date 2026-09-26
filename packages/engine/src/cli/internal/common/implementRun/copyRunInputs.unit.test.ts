import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { copyRunInputs } from '#src/cli/internal/common/implementRun/copyRunInputs.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const planName = 'lo-9-isolated-implement';
const planFolderPath = join('.lightsout', 'work-orders', planName, 'plans');
const overviewBody = '# overview\n\nthe whole plan, in phases\n';
const phaseBody = '# phase 3: isolated implement\n';
const factsBody = '{"facts":[]}\n';
const ticketBody = '# LO-9 run implement in a new worktree\n';

/** A launching checkout holding a real plan folder, beside an empty workspace the run works in. */
const setupPlanFolder = async () => {
	const sourceCwd = await freshCwd();
	const workspace = await freshCwd();
	const planDir = join(sourceCwd, planFolderPath);

	mkdirSync(planDir, { recursive: true });
	writeFileSync(join(planDir, 'overview.md'), overviewBody);
	writeFileSync(join(planDir, 'phase3-isolated-implement.md'), phaseBody);
	writeFileSync(join(planDir, 'facts.json'), factsBody);

	return { sourceCwd, workspace, planDir };
};

/**
 * A launching checkout holding one loose markdown input, beside an empty workspace.
 *
 * `outside` puts the input in a directory of its own instead — an input the
 * user named from somewhere else on the machine entirely.
 */
const setupLooseInput = async ({ fileName = 'lo-9-ticket.md', outside = false }: { fileName?: string; outside?: boolean } = {}) => {
	const sourceCwd = await freshCwd();
	const workspace = await freshCwd();
	const trackedDir = outside ? await freshCwd() : join(sourceCwd, 'notes');

	mkdirSync(trackedDir, { recursive: true });
	writeFileSync(join(trackedDir, fileName), ticketBody);

	const inputPath = outside ? join(trackedDir, fileName) : join('notes', fileName);

	return { sourceCwd, workspace, inputPath };
};

const gradedPlanBody = '# plan\n\nthe graded, repaired plan\n';
const gradeMemoryBody = '{"passes":[{"grade":"A"}]}\n';
const stalePlanBody = '# plan\n\nthe draft left behind before planning moved\n';

/**
 * A workspace already holding the graded plan folder planning left in it,
 * beside a launching checkout holding an older folder of the same name.
 */
const setupStockedWorkspace = async () => {
	const sourceCwd = await freshCwd();
	const workspace = await freshCwd();
	const staleDir = join(sourceCwd, planFolderPath);
	const gradedDir = join(workspace, planFolderPath);

	mkdirSync(staleDir, { recursive: true });
	writeFileSync(join(staleDir, 'plan.md'), stalePlanBody);
	writeFileSync(join(staleDir, 'grade-memory.json'), '{"passes":[]}\n');
	writeFileSync(join(staleDir, 'facts.json'), factsBody);
	mkdirSync(gradedDir, { recursive: true });
	writeFileSync(join(gradedDir, 'plan.md'), gradedPlanBody);
	writeFileSync(join(gradedDir, 'grade-memory.json'), gradeMemoryBody);

	return { sourceCwd, workspace, gradedDir };
};

const ticketFolderPath = join('.lightsout', 'work-orders', 'lo-7-search', 'plans');
const earlierPlanBody = '# plan\n\nthe earlier plan the workspace already holds\n';
const laterPlanBody = '# plan\n\nthe later plan of the same ticket\n';

/**
 * A launching checkout holding the later plan folder of a ticket, beside a
 * workspace already holding an earlier plan folder of the same ticket.
 */
const setupTicketFolder = async () => {
	const sourceCwd = await freshCwd();
	const workspace = await freshCwd();
	const laterDir = join(sourceCwd, ticketFolderPath, '002-ranking');
	const earlierDir = join(workspace, ticketFolderPath, '001-basics');

	mkdirSync(laterDir, { recursive: true });
	writeFileSync(join(laterDir, 'plan.md'), laterPlanBody);
	writeFileSync(join(laterDir, 'facts.json'), factsBody);
	mkdirSync(earlierDir, { recursive: true });
	writeFileSync(join(earlierDir, 'plan.md'), earlierPlanBody);

	return { sourceCwd, workspace, earlierDir };
};

/**
 * A launching checkout holding both a real plan folder and one loose markdown
 * input, beside an empty workspace — the two kinds of input a run is given at
 * once.
 */
const setupPlanFolderAndLooseInput = async () => {
	const sourceCwd = await freshCwd();
	const workspace = await freshCwd();
	const planDir = join(sourceCwd, planFolderPath);
	const notesDir = join(sourceCwd, 'notes');

	mkdirSync(planDir, { recursive: true });
	writeFileSync(join(planDir, 'overview.md'), overviewBody);
	writeFileSync(join(planDir, 'facts.json'), factsBody);
	mkdirSync(notesDir, { recursive: true });
	writeFileSync(join(notesDir, 'lo-9-ticket.md'), ticketBody);

	return { sourceCwd, workspace, planDir, loosePath: join('notes', 'lo-9-ticket.md') };
};

describe('copyRunInputs', () => {
	test('leaves the whole plan folder where it is and answers its repo-relative path', async () => {
		const { sourceCwd, workspace, planDir } = await setupPlanFolder();

		const result = await copyRunInputs({ sourceCwd, workspace, planPath: planFolderPath });

		expect(result).toEqual({ planPath: planFolderPath });
		expect(existsSync(join(workspace, planFolderPath))).toBe(false);
		expect(readdirSync(planDir).sort()).toStrictEqual(['facts.json', 'overview.md', 'phase3-isolated-implement.md']);
		expect(readFileSync(join(planDir, 'overview.md'), 'utf8')).toBe(overviewBody);
	});

	test('normalises an absolute plan path onto the repo-relative one the manifest records', async () => {
		const { sourceCwd, workspace, planDir } = await setupPlanFolder();

		const result = await copyRunInputs({ sourceCwd, workspace, planPath: join(sourceCwd, planFolderPath) });

		expect(result).toEqual({ planPath: planFolderPath });
		expect(existsSync(join(workspace, planFolderPath))).toBe(false);
		expect(readFileSync(join(planDir, 'phase3-isolated-implement.md'), 'utf8')).toBe(phaseBody);
	});

	test('copies a ticket file into the ignored state directory, never onto a tracked path', async () => {
		const { sourceCwd, workspace, inputPath } = await setupLooseInput();

		const result = await copyRunInputs({ sourceCwd, workspace, ticketPath: inputPath });

		expect(result).toEqual({ ticketPath: join('.lightsout', 'inputs', 'lo-9-ticket.md') });
		expect(readFileSync(join(workspace, '.lightsout', 'inputs', 'lo-9-ticket.md'), 'utf8')).toBe(ticketBody);
		expect(existsSync(join(workspace, 'notes', 'lo-9-ticket.md'))).toBe(false);
	});

	test('copies a loose plan file into the ignored state directory too', async () => {
		const { sourceCwd, workspace, inputPath } = await setupLooseInput({ fileName: 'rough-plan.md' });

		const result = await copyRunInputs({ sourceCwd, workspace, planPath: inputPath });

		expect(result).toEqual({ planPath: join('.lightsout', 'inputs', 'rough-plan.md') });
		expect(readFileSync(join(workspace, '.lightsout', 'inputs', 'rough-plan.md'), 'utf8')).toBe(ticketBody);
		expect(existsSync(join(workspace, 'notes', 'rough-plan.md'))).toBe(false);
	});

	test('copies an input from outside the checkout rather than reading the original in place', async () => {
		const { sourceCwd, workspace, inputPath } = await setupLooseInput({ outside: true });

		const result = await copyRunInputs({ sourceCwd, workspace, ticketPath: inputPath });

		expect(result).toEqual({ ticketPath: join('.lightsout', 'inputs', 'lo-9-ticket.md') });
		expect(readFileSync(join(workspace, '.lightsout', 'inputs', 'lo-9-ticket.md'), 'utf8')).toBe(ticketBody);
	});

	test('answers one sentence when an input cannot be copied', async () => {
		const { sourceCwd, workspace, inputPath } = await setupLooseInput();

		writeFileSync(join(workspace, '.lightsout'), 'a file where the state directory belongs\n');

		const result = await copyRunInputs({ sourceCwd, workspace, ticketPath: inputPath });

		expect(result).toEqual({ error: expect.any(String) });
		expect(readdirSync(workspace)).toStrictEqual(['.lightsout']);
	});

	test('never copies a plan folder over one the workspace already holds', async () => {
		const { sourceCwd, workspace, gradedDir } = await setupStockedWorkspace();

		const result = await copyRunInputs({ sourceCwd, workspace, planPath: planFolderPath });

		expect(result).toEqual({ planPath: planFolderPath });
		expect(readdirSync(gradedDir).sort()).toStrictEqual(['grade-memory.json', 'plan.md']);
		expect(readFileSync(join(gradedDir, 'plan.md'), 'utf8')).toBe(gradedPlanBody);
		expect(readFileSync(join(gradedDir, 'grade-memory.json'), 'utf8')).toBe(gradeMemoryBody);
	});

	test("a later plan of a ticket is answered where it is, leaving the workspace's earlier plan alone", async () => {
		const { sourceCwd, workspace, earlierDir } = await setupTicketFolder();

		const result = await copyRunInputs({ sourceCwd, workspace, planPath: join(ticketFolderPath, '002-ranking', 'plan.md') });

		expect(result).toEqual({ planPath: join(ticketFolderPath, '002-ranking', 'plan.md') });
		expect(existsSync(join(workspace, ticketFolderPath, '002-ranking'))).toBe(false);
		expect(readFileSync(join(sourceCwd, ticketFolderPath, '002-ranking', 'plan.md'), 'utf8')).toBe(laterPlanBody);
		expect(readdirSync(earlierDir)).toStrictEqual(['plan.md']);
		expect(readFileSync(join(earlierDir, 'plan.md'), 'utf8')).toBe(earlierPlanBody);
	});

	test('a plan-folder input is left where it is and answered unchanged, while a loose input is still copied in', async () => {
		const { sourceCwd, workspace, planDir, loosePath } = await setupPlanFolderAndLooseInput();

		const result = await copyRunInputs({ sourceCwd, workspace, planPath: planFolderPath, ticketPath: loosePath });

		expect(result).toStrictEqual({ planPath: planFolderPath, ticketPath: join('.lightsout', 'inputs', 'lo-9-ticket.md') });
		expect(existsSync(join(workspace, '.lightsout', 'work-orders'))).toBe(false);
		expect(readFileSync(join(workspace, '.lightsout', 'inputs', 'lo-9-ticket.md'), 'utf8')).toBe(ticketBody);
		expect(readdirSync(planDir).sort()).toStrictEqual(['facts.json', 'overview.md']);
		expect(readFileSync(join(planDir, 'overview.md'), 'utf8')).toBe(overviewBody);
	});
});
