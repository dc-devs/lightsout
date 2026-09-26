import { describe, expect, test } from '@jest/globals';
import { buildActivityTree } from '#src/activity/buildActivityTree.ts';
import { readActivityMarks } from '#src/activity/readActivityMarks.ts';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planDraftCommand } from '#src/cli/plan/planDraftCommand.ts';
import type { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { createScriptedDraftDriver, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { dirtyPlanBody } from '#tests/helpers/dirtyPlanBody.ts';
import { setupPhasedDraft } from '#tests/helpers/phasedDraftFixture.ts';

// What `plan draft` writes into the plan folder's activity record: the two
// levels the command itself opens, and the level its draft spawns answer to.
// What the draft prints and how it exits are the other draft suites' subject;
// only the recorded shape is read here.

/** A seeded single-plan workspace, the flags the command is handed, and the captured CLI surface. */
const setupDraftActivity = ({ name, args = [] }: { name: string; args?: string[] }) => {
	const captured = captureCommandOutput();
	// no touched files, so the estimate lands on the one-file variant and a clean
	// draft is a single spawn
	const { cwd, planDir } = setupPhasedDraft({ name, touching: 0 });

	return { cwd, name, planDir, flags: parseFlags({ args }), ...captured };
};

/** A writer whose every spawn comes back rate limited, under the harness name the focused preflight credits. */
const rateLimitedWriter = (): Driver => createScriptedDraftDriver({ respond: () => ({ text: '', exitCode: 1, rateLimited: true }) });

/** A writer that authors a plan carrying a placeholder and whose repair spawn edits nothing, so the finding survives the loop. */
const stubbornlyDirtyWriter = (): Driver =>
	createScriptedDraftDriver({ respond: ({ role, path }) => (role === 'repair' ? unchangedFixReport({ path }) : dirtyPlanBody()) });

/** The roots of one plan folder's folded record. The command settles every mark before it exits, so what is on disk here is the whole run. */
const readPlanRoots = async ({ planDir, name }: { planDir: string; name: string }): Promise<ActivityNode[]> =>
	buildActivityTree({ plan: name, marks: await readActivityMarks({ dir: planDir }) }).roots;

describe('planDraftCommand activity levels', () => {
	test('a draft records a command run under the plan level, holding its writer spawn as a step', async () => {
		const { cwd, name, planDir, flags, exitCodes } = setupDraftActivity({ name: 'demo' });
		const driver = createDraftDriver({ bodies: [cleanPlanBody()] });

		await expect(planDraftCommand({ cwd, driver, name, standards: undefined, config: undefined, flags })).rejects.toThrow(/process\.exit/);

		const roots = await readPlanRoots({ planDir, name });

		// One plan row holding one command run, both closed before the command
		// exits; the writer spawn beneath the command run is what proves the level
		// reached the runner — a spawn recorded with no command run above it could
		// never be attributed to the command that paid for it.
		expect(roots).toEqual([
			expect.objectContaining({
				level: 'plan',
				label: 'demo',
				endedAt: expect.any(String),
				outcome: 'passed',
				children: [
					expect.objectContaining({
						level: 'command-run',
						label: 'plan draft',
						endedAt: expect.any(String),
						outcome: 'passed',
						children: [expect.objectContaining({ level: 'step', label: 'draft', endedAt: expect.any(String) })],
					}),
				],
			}),
		]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test.each([
		{ ending: 'a rate-limited writer', writer: rateLimitedWriter, outcome: 'paused-rate-limit' },
		{ ending: 'structural issues that survive the repair loop', writer: stubbornlyDirtyWriter, outcome: 'failed' },
	])('the command run ends $outcome when $ending ends the draft with exit 1', async ({ writer, outcome }) => {
		const { cwd, name, planDir, flags, exitCodes } = setupDraftActivity({ name: 'demo' });
		const driver = writer();

		await expect(planDraftCommand({ cwd, driver, name, standards: undefined, config: undefined, flags })).rejects.toThrow(/process\.exit/);

		const roots = await readPlanRoots({ planDir, name });

		// A pause to resume and a failure are different answers to "what should
		// happen next", so the end mark has to keep them apart rather than
		// flattening every non-zero exit into one word.
		expect(roots).toEqual([expect.objectContaining({ outcome, children: [expect.objectContaining({ level: 'command-run', outcome })] })]);
		expect(exitCodes).toStrictEqual([1]);
	});
});
