import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import { type RunManifest, RunStatus, type ShipResult } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { readWorktreeRecord, resolveWorktreePath } from '#src/worktree/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { manifestOf } from '#tests/helpers/setupResume.ts';

// Mocked Imports
// -------------------------
// Git is real throughout — a repo with a real origin, a tree git actually cuts
// and a removal git actually performs — because whether the shipped tree came
// down, and what survived it, are git's answers rather than a stub's. Only the
// merge itself is doubled: it is the one step that would leave the machine, and
// `exitAfterImplement.unit.test.ts` already pins what it does.
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	runShip: (params: { cwd: string }) => mockRunShip(params),
}));
// -------------------------
const mockRequireImplementLifecycle = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	requireImplementLifecycle: (params: { cwd: string }) => mockRequireImplementLifecycle(params),
}));
// -------------------------
const mockRunPipelineOrFailFast = jest.fn<(params: { cwd: string; planPath: string }) => Promise<PipelineResult>>();

jest.mock('#src/cli/common/utils/runPipelineOrFailFast.ts', () => ({
	runPipelineOrFailFast: (params: { cwd: string; planPath: string }) => mockRunPipelineOrFailFast(params),
}));
// -------------------------
// The report card reads a run directory no mocked pipeline ever wrote, and its
// lines would sit between the cleanup's own progress lines.
const mockPrintResult = jest.fn<(params: { result: PipelineResult; cwd: string }) => Promise<void>>();

jest.mock('#src/cli/common/render/printResult.ts', () => ({
	printResult: (params: { result: PipelineResult; cwd: string }) => mockPrintResult(params),
}));
// -------------------------

const ticketBranch = 'lo-7-search';
const ticketFolder = join('.lightsout', 'tickets', ticketBranch);
const laterPlanFolder = join(ticketFolder, 'plans', '002-ranking');
const earlierPlanFolder = join(ticketFolder, 'plans', '001-basics');

const planBody = '# Plan: rank the results\n';
const earlierPlanBody = '# Plan: the basics, graded in the ticket tree\n';
const primaryOnlyNotes = '# what the primary checkout keeps for this ticket\n';

/** What the merge answers once the run has passed — the only step here that would reach a forge. */
const merged: ShipResult = { status: 'shipped', ticketRef: 'lo-7', failingChecks: [] };

/**
 * A shipped run of the ticket's LATER plan, in a repo with a real origin behind
 * it.
 *
 * The launching checkout holds that plan's folder, the ticket's earlier plan and
 * a note of its own beside them, because that is where every plan folder lives
 * whichever checkout a command runs from. A folder of the same name is planted
 * inside the tree while the run is going, holding different text, so a rescue
 * copy out of the tree would be visible rather than silent: only a copy could
 * put the tree's text into the primary checkout afterwards.
 */
const setupShippedTicketRun = async () => {
	const captured = captureCommandOutput();
	const { cwd } = setupBranchRepo();
	const treePath = await resolveWorktreePath({ cwd, branch: ticketBranch });

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false } }));
	mkdirSync(join(cwd, laterPlanFolder), { recursive: true });
	writeFileSync(join(cwd, laterPlanFolder, 'plan.md'), planBody);
	mkdirSync(join(cwd, earlierPlanFolder), { recursive: true });
	writeFileSync(join(cwd, earlierPlanFolder, 'plan.md'), earlierPlanBody);
	writeFileSync(join(cwd, ticketFolder, 'notes.md'), primaryOnlyNotes);

	mockRequireImplementLifecycle.mockResolvedValue(undefined);
	mockPrintResult.mockResolvedValue(undefined);
	mockRunShip.mockResolvedValue(merged);
	mockRunPipelineOrFailFast.mockImplementation(({ cwd: workspace, planPath }) => {
		mkdirSync(join(workspace, laterPlanFolder), { recursive: true });
		writeFileSync(join(workspace, laterPlanFolder, 'plan.md'), '# a stale copy no cleanup may read\n');

		const manifest: RunManifest = manifestOf({ status: RunStatus.Passed, branch: ticketBranch, workspace, plan: planPath });

		return Promise.resolve({ ok: true, manifest } as unknown as PipelineResult);
	});

	const args = ['--plan', join(laterPlanFolder, 'plan.md'), '--ship'];

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, treePath, ...captured };
};

describe('implementCommand ship cleanup', () => {
	test('takes the shipped tree down with no plan to save, leaving the primary checkout untouched', async () => {
		const { context, cwd, treePath, exitCodes } = await setupShippedTicketRun();

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		const record = await readWorktreeRecord({ cwd, branch: ticketBranch });
		// the run built in the ticket branch's tree, and the merge took it down
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd: treePath }));
		expect(existsSync(treePath)).toBe(false);
		expect(record).toBeUndefined();
		// the plan this run built and the ticket's other plan are both still the
		// primary checkout's own text — a rescue copy would have overwritten the one
		// the tree also held
		expect(readFileSync(join(cwd, laterPlanFolder, 'plan.md'), 'utf8')).toBe(planBody);
		expect(readFileSync(join(cwd, earlierPlanFolder, 'plan.md'), 'utf8')).toBe(earlierPlanBody);
		// a file only the primary checkout holds is left exactly where it is
		expect(readFileSync(join(cwd, ticketFolder, 'notes.md'), 'utf8')).toBe(primaryOnlyNotes);
		expect(exitCodes).toStrictEqual([0]);
	});
});
