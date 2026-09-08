import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { planSyncDecisionsCommand } from '#src/cli/plan/index.ts';
import { DecisionSource } from '#src/contracts/index.ts';
import { syncPlanDecisions } from '#src/plan/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// plan sync-decisions is deterministic — no agent, no driver — so the
// arrangement is a real consumer repo holding a real plan file and a real
// decisions record, rewritten through the same runner the CLI calls.
const setupSync = ({ name = 'demo', seed = true, args }: { name?: string; seed?: boolean; args: string[] }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });

	if (seed) {
		const dir = writePlanDeliverable({ cwd, name, body: cleanPlanBody() });

		writeFileSync(
			join(dir, 'decisions.json'),
			JSON.stringify({
				planName: name,
				decisions: [
					{
						source: DecisionSource.Elicitation,
						question: 'Where does the log live?',
						options: 'overview / every phase',
						choice: 'the overview',
						rationale: 'one home for the history',
						assumption: false,
					},
				],
			}),
		);
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/**
 * The same repo with the log already written, so the command's run finds every
 * section it would render already in place — the arrangement a human repeating
 * the command lands in.
 */
const setupSyncedRepo = async ({ args }: { args: string[] }) => {
	const arranged = setupSync({ args });

	await syncPlanDecisions({ cwd: arranged.cwd, name: 'demo' });

	return arranged;
};

test('planSyncDecisionsCommand: prints one updated-or-unchanged line per plan file and exits 0', async () => {
	const { logged, errors, exitCodes, context } = setupSync({ args: ['--name', 'demo'] });

	await expect(planSyncDecisionsCommand(context)).rejects.toThrow(/process\.exit/);

	const fileLines = logged.filter((line) => line.includes('plan.md'));

	// the headline names the plan the sync ran for
	expect(logged[0] ?? '').toMatch(/demo/);
	// exactly one per-file line, naming the file and what the write did to it
	expect(fileLines.length).toBe(1);
	expect(fileLines[0] ?? '').toMatch(/updated/i);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planSyncDecisionsCommand: reports a file unchanged when its log already matches', async () => {
	const { logged, errors, exitCodes, context } = await setupSyncedRepo({ args: ['--name', 'demo'] });

	await expect(planSyncDecisionsCommand(context)).rejects.toThrow(/process\.exit/);

	const fileLines = logged.filter((line) => line.includes('plan.md'));

	// still one line per file — a repeat that moved nothing has to say so rather
	// than print nothing at all
	expect(fileLines.length).toBe(1);
	expect(fileLines[0] ?? '').toMatch(/unchanged/i);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('planSyncDecisionsCommand: prints the resolution error on stderr and exits 1', async () => {
	const { logged, errors, exitCodes, context } = setupSync({ seed: false, args: ['--name', 'ghost'] });

	await expect(planSyncDecisionsCommand(context)).rejects.toThrow(/process\.exit/);

	// the failure is a stderr-only surface: nothing is reported as done
	expect(logged).toStrictEqual([]);
	expect(errors[0] ?? '').toMatch(/no plan found for 'ghost'/);
	expect(exitCodes).toStrictEqual([1]);
});
