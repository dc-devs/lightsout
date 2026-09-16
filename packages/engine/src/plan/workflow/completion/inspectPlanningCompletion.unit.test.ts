// Dependencies
import { writeFile } from 'node:fs/promises';
import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { answerPlanningQuestion, capturePlanningInput, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { inspectPlanningCompletion } from '#src/plan/workflow/completion/index.ts';
import { planningArchitectEvidenceFixture } from '#tests/helpers/planningArchitectEvidenceFixture.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';
import { planningUnknownWorkflowFixture } from '#tests/helpers/planningUnknownWorkflowFixture.ts';
import { planningQuestionAnswer } from '#tests/helpers/planningWorkflowQuestionScenario.ts';

const setup = async ({ changed = false }: { changed?: boolean } = {}) => {
	const fixture = await planningReviewFixture();
	fixture.runtime.config['auto-plan'] = { 'auto-approve-plan': true };
	await fixture.run();
	if (changed) {
		const text = 'Changed requirement: retries must also preserve expiry.';
		await capturePlanningInput({
			runtime: fixture.runtime,
			input: {
				stage: fixture.runtime.stage,
				sources: [{ artifact: 'followup.txt', locator: 'User follow-up', text, sha256: sha256({ content: text }) }],
				claims: [],
				confirmations: [],
			},
		});
	}
	return {
		...fixture,
		params: { cwd: fixture.cwd, config: fixture.runtime.config, snapshot: await fixture.current(), stage: PlanningVocabulary.Stage.Implementation },
	};
};

describe('inspectPlanningCompletion', () => {
	test('revalidates actual completed independent proofs without invoking another provider', async () => {
		const fixture = await setup();
		const calls = fixture.calls.length;

		const readiness = await inspectPlanningCompletion(fixture.params);

		expect(readiness.ready).toBe(true);
		expect(readiness.generation).toBe(fixture.params.snapshot.digest);
		expect(fixture.calls).toHaveLength(calls);
	});

	test('refuses a prior completion after original intent changes', async () => {
		const fixture = await setup({ changed: true });

		const readiness = await inspectPlanningCompletion(fixture.params);

		expect(readiness.ready).toBe(false);
		expect(readiness.missingReason).toContain('no completed engine cycle');
	});
	test('accepts current consumer revalidation without requiring unchanged historical author observations', async () => {
		const fixture = await planningArchitectEvidenceFixture();
		fixture.runtime.config['auto-plan'] = { 'auto-approve-plan': true };
		await fixture.run();
		await writeFile(fixture.sourcePath, 'export const retention = "completed uploads and metadata";');
		const completed = await runPlanning({ runtime: fixture.runtime });
		if (completed.status !== PlanningVocabulary.Status.Complete) throw new Error(JSON.stringify(completed));
		const snapshot = await fixture.current();
		const calls = fixture.calls.length;

		const readiness = await inspectPlanningCompletion({ cwd: fixture.cwd, config: fixture.runtime.config, snapshot, stage: fixture.runtime.stage });

		expect(readiness.ready).toBe(true);
		expect(fixture.calls).toHaveLength(calls);
	});

	test('uses the completed cycle assurance for publication without silently starting a new semantic entry', async () => {
		const fixture = await planningUnknownWorkflowFixture();
		const question = await runPlanning({ runtime: fixture.runtime });
		if (question.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error(JSON.stringify(question));
		const aligned = await answerPlanningQuestion({
			runtime: fixture.runtime,
			answer: planningQuestionAnswer({ result: question, delegation: fixture.scope, alignment: true }),
		});
		if (aligned.status !== PlanningVocabulary.Status.Aligned) throw new Error(JSON.stringify(aligned));
		const snapshot = await readPlanningSnapshot(fixture);
		if (!snapshot) throw new Error('Expected completed aligned generation');
		const calls = fixture.assuranceCalls.length;

		const readiness = await inspectPlanningCompletion({ cwd: fixture.cwd, config: fixture.runtime.config, snapshot, stage: fixture.runtime.stage });

		expect(readiness.ready).toBe(true);
		expect(calls).toBeGreaterThan(0);
		expect(fixture.assuranceCalls).toHaveLength(calls);
	});
});
