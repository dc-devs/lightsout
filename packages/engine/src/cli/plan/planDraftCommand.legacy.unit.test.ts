import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planDraftCommand } from '#src/cli/plan/planDraftCommand.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { Permissions } from '#src/contracts/Permissions.ts';
import type { DraftImplementation } from '#src/contracts/plan/draft/DraftImplementation.ts';
import { PlanVariant } from '#src/contracts/plan/draft/PlanVariant.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import type { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';

// Mocked Imports
// -------------------------
// The runner is the only seam replaced: what this file owns is which
// implementation the command resolves from the flag and where that choice goes.
// Every other export of the plan module stays real, so the planning record the
// command writes around the runner lands on disk and is read back from the file
// it actually wrote.
interface DraftParams {
	cwd: string;
	driver: Driver;
	name: string;
	scope?: PlanVariant;
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
	implementation?: DraftImplementation;
}

const mockRunPlanDraft = jest.fn<(params: DraftParams) => ReturnType<typeof runPlanDraft>>();

jest.mock('#src/plan/index.ts', () => ({
	...jest.requireActual<typeof import('#src/plan/index.ts')>('#src/plan/index.ts'),
	runPlanDraft: (params: DraftParams) => mockRunPlanDraft(params),
}));
// -------------------------

/** Never invoked — the runner above is stubbed, so nothing reaches a harness. */
const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

/** The draft step's entry in one plan folder's planning record, read off disk. */
const draftStepOf = ({ cwd, name }: { cwd: string; name: string }): unknown => {
	const record = JSON.parse(readFileSync(join(planWorkspaceFolder({ cwd: cwd, name: name }), 'planning-progress.json'), 'utf8')) as { steps: unknown[] };

	return record.steps[0];
};

/**
 * One temp repo holding a plan folder per implementation — the folders must
 * exist before the command runs, because the planning record is never what
 * creates one — with the runner answering a clean single-plan draft for
 * whichever plan it was asked for.
 */
const setupDraftCommands = () => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-draft-legacy-'));
	const names = { legacy: 'legacy-draft', focused: 'focused-draft' };

	for (const name of Object.values(names)) {
		mkdirSync(planWorkspaceFolder({ cwd: cwd, name: name }), { recursive: true });
	}

	mockRunPlanDraft.mockImplementation(async ({ name, implementation }) => {
		const workspaceDir = planWorkspaceFolder({ cwd: cwd, name: name });

		return {
			status: PlanRunStatus.Complete,
			workspaceDir,
			planPaths: [join(workspaceDir, 'plan.md')],
			variant: PlanVariant.Single,
			reports: [],
			advisories: [],
			implementation: implementation ?? 'focused',
		};
	});

	return { cwd, names, legacyFlags: parseFlags({ args: ['--legacy'] }), focusedFlags: parseFlags({ args: [] }), ...captured };
};

describe('planDraftCommand', () => {
	test('selects and records the legacy implementation only when the flag is typed', async () => {
		const { cwd, names, legacyFlags, focusedFlags, exitCodes } = setupDraftCommands();

		await expect(planDraftCommand({ cwd, driver, name: names.legacy, standards: undefined, config: undefined, flags: legacyFlags })).rejects.toThrow(
			/process\.exit/,
		);
		await expect(planDraftCommand({ cwd, driver, name: names.focused, standards: undefined, config: undefined, flags: focusedFlags })).rejects.toThrow(
			/process\.exit/,
		);

		// the typed flag is the only way legacy is reached, and its absence is a
		// resolved focused draft rather than a question left to the runner
		expect(mockRunPlanDraft.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ name: 'legacy-draft', implementation: 'legacy' }));
		expect(mockRunPlanDraft.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ name: 'focused-draft', implementation: 'focused' }));
		// the record is what attributes a plan folder to the implementation that
		// produced it, so the choice has to survive the run onto disk
		expect(draftStepOf({ cwd, name: names.legacy })).toEqual(expect.objectContaining({ step: 'draft', status: 'passed', implementation: 'legacy' }));
		expect(draftStepOf({ cwd, name: names.focused })).toEqual(expect.objectContaining({ step: 'draft', status: 'passed', implementation: 'focused' }));
		expect(exitCodes).toStrictEqual([0, 0]);
	});
});
