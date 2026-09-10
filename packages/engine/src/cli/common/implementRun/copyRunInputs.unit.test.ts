import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { copyRunInputs } from '#src/cli/common/implementRun/copyRunInputs.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const planName = 'lo-9-isolated-implement';
const planFolderPath = join('.lightsout', 'plans', planName);
const overviewBody = '# overview\n\nthe whole plan, in phases\n';
const phaseBody = '# phase 3: isolated implement\n';
const factsBody = '{"facts":[]}\n';
const ticketBody = '# LO-9 run implement in a new worktree\n';

/** A launching checkout holding a real plan folder, beside an empty workspace to copy it into. */
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

describe('copyRunInputs', () => {
	test('copies the whole plan folder and answers its workspace-relative path', async () => {
		const { sourceCwd, workspace, planDir } = await setupPlanFolder();

		const result = await copyRunInputs({ sourceCwd, workspace, planPath: planFolderPath });

		expect(result).toEqual({ planPath: planFolderPath });
		expect(readdirSync(join(workspace, planFolderPath)).sort()).toStrictEqual(['facts.json', 'overview.md', 'phase3-isolated-implement.md']);
		expect(readFileSync(join(workspace, planFolderPath, 'overview.md'), 'utf8')).toBe(overviewBody);
		expect(readdirSync(planDir).sort()).toStrictEqual(['facts.json', 'overview.md', 'phase3-isolated-implement.md']);
		expect(readFileSync(join(planDir, 'overview.md'), 'utf8')).toBe(overviewBody);
	});

	test('normalises an absolute plan path onto the copy in the workspace', async () => {
		const { sourceCwd, workspace } = await setupPlanFolder();

		const result = await copyRunInputs({ sourceCwd, workspace, planPath: join(sourceCwd, planFolderPath) });

		expect(result).toEqual({ planPath: planFolderPath });
		expect(readFileSync(join(workspace, planFolderPath, 'phase3-isolated-implement.md'), 'utf8')).toBe(phaseBody);
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
});
