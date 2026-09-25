import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { PlanWorktree } from '#src/cli/plan/common/types/PlanWorktree.ts';
import { openPlanWorktree } from '#src/cli/plan/common/utils/openPlanWorktree.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

// Mocked Imports
// -------------------------
// The resolver is the seam every git command behind this function runs through,
// so mocking it is what lets a moved session be arranged without cutting a real
// tree. The two checkouts themselves are real directories, because what is
// being asserted is what is on disk beside them afterwards.
interface ResolveParams {
	cwd: string;
	config: LightsoutConfig | undefined;
	flags: CommandContext['flags'];
	name: string;
	onProgress?: (message: string) => void;
}

const mockResolvePlanWorktree = jest.fn<(params: ResolveParams) => Promise<PlanWorktree | { error: string }>>();

jest.mock('#src/cli/plan/common/utils/resolvePlanWorktree.ts', () => ({
	resolvePlanWorktree: (params: ResolveParams) => mockResolvePlanWorktree(params),
}));
// -------------------------

const name = 'lo-150-planning-gives-no-breakdown';
const planFolderPath = join('.lightsout', 'work-orders', name, 'plans');
const planBody = '# Planning observability\n\nthe plan the launching checkout already holds\n';
const notesBody = '# brainstorm notes\n\nplan data lives in the main checkout\n';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/**
 * A launching checkout holding a plan folder, and a freshly cut planning
 * worktree the resolver answers with. The session moved, because the two
 * directories are different, so the announcement line is captured rather than
 * printed into the reporter.
 */
const setupMovedSession = async () => {
	const sourceCwd = await freshCwd();
	const worktreeCwd = await freshCwd();
	const sourcePlanDir = join(sourceCwd, planFolderPath);

	await mkdir(sourcePlanDir, { recursive: true });
	await Promise.all([writeFile(join(sourcePlanDir, 'plan.md'), planBody), writeFile(join(sourcePlanDir, 'brainstorm-notes.md'), notesBody)]);

	mockResolvePlanWorktree.mockResolvedValue({ cwd: worktreeCwd, branch: name, isolated: true, created: true });
	jest.spyOn(console, 'log').mockImplementation(() => undefined);

	return { sourceCwd, worktreeCwd, sourcePlanDir, config: { gates } as LightsoutConfig, flags: new Map<string, string | true>() };
};

describe('openPlanWorktree', () => {
	test('a session that moved into its worktree leaves no plan folder inside the tree', async () => {
		const { sourceCwd, worktreeCwd, sourcePlanDir, config, flags } = await setupMovedSession();

		const opened = await openPlanWorktree({ cwd: sourceCwd, config, flags, name });

		const insideTree = await readdir(worktreeCwd);
		const insideSourceFolder = await readdir(sourcePlanDir);
		const sourcePlan = await readFile(join(sourcePlanDir, 'plan.md'), 'utf8');
		const sourceNotes = await readFile(join(sourcePlanDir, 'brainstorm-notes.md'), 'utf8');

		expect(opened).toStrictEqual({ worktree: { cwd: worktreeCwd, branch: name, isolated: true, created: true } });
		expect(insideTree).toStrictEqual([]);
		expect(insideSourceFolder.sort()).toStrictEqual(['brainstorm-notes.md', 'plan.md']);
		expect(sourcePlan).toBe(planBody);
		expect(sourceNotes).toBe(notesBody);
	});
});
