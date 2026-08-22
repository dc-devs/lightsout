import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/index.ts';
import { advisoryPlanBody, plantAdvisoryTouchedFiles } from '#tests/helpers/advisoryPlan.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** The advisory skeleton with a placeholder planted — a blocking finding standing beside the touched-file note. */
const blockingAdvisoryPlan = () => advisoryPlanBody().replace('A new module exporting', 'TBD — a new module exporting');

/** A repo whose 50 mechanically-edited modules are on disk, plus a writer authoring `bodies` in turn. */
const setupAdvisoryDraft = ({ name, bodies }: { name: string; bodies: string[] }) => {
	const cwd = setupConsumerRepo();

	plantAdvisoryTouchedFiles({ cwd });
	seedPlanWorkspace({ cwd, name });

	const prompts: string[] = [];
	const driver = createDraftDriver({ bodies, onCall: (prompt) => prompts.push(prompt) });

	return { cwd, driver, prompts };
};

describe('runPlanDraft advisories', () => {
	test('a plan whose only finding is the touched-file note drafts clean, with the note riding the result', async () => {
		const { cwd, driver } = setupAdvisoryDraft({ name: 'noted', bodies: [advisoryPlanBody()] });

		const result = await runPlanDraft({ cwd, driver, name: 'noted' });

		expectStatus(result, 'complete');
		// left as a length test, this note would park every large mechanical plan
		// as structural-issues — the outcome the two-number split exists to prevent
		expect(result.advisories.map(({ check, severity, issue }) => ({ check, severity, issue }))).toStrictEqual([
			{
				check: StructuralCheck.ScopeWithinGuardrail,
				severity: FindingSeverity.Advisory,
				issue: 'plan touches 51 source files, over the 50-file limit from the configured executor-file-limit',
			},
		]);
	});

	test('the touched-file note never spends a repair attempt', async () => {
		const { cwd, driver, prompts } = setupAdvisoryDraft({ name: 'unrepaired', bodies: [advisoryPlanBody()] });

		const result = await runPlanDraft({ cwd, driver, name: 'unrepaired' });

		expectStatus(result, 'complete');
		// one author spawn and nothing else: an advisory is not a defect to fix
		expect(prompts.length).toBe(1);
	});

	test('a blocking finding beside the note parks the draft, with the note listed separately from the survivors', async () => {
		const { cwd, driver } = setupAdvisoryDraft({ name: 'parked', bodies: [blockingAdvisoryPlan(), blockingAdvisoryPlan()] });

		const result = await runPlanDraft({ cwd, driver, name: 'parked' });

		expectStatus(result, 'structural-issues');
		expect({ findings: result.findings.map(({ check }) => check), advisories: result.advisories.map(({ check }) => check) }).toStrictEqual({
			findings: [StructuralCheck.NoPlaceholders, StructuralCheck.ScopeWithinGuardrail],
			advisories: [StructuralCheck.ScopeWithinGuardrail],
		});
	});

	test('the repairer is handed the blocking finding alone', async () => {
		const { cwd, driver, prompts } = setupAdvisoryDraft({ name: 'repair-input', bodies: [blockingAdvisoryPlan(), advisoryPlanBody()] });

		const result = await runPlanDraft({ cwd, driver, name: 'repair-input' });

		expectStatus(result, 'complete');

		const repairPrompt = prompts.find((prompt) => prompt.includes('# Repair input'));

		// the placeholder forced exactly one repair
		expectDefined(repairPrompt);
		expect(repairPrompt).toContain(`[${StructuralCheck.NoPlaceholders}]`);
		// an advisory reaching the repairer would spend an attempt telling it to
		// fix something that is not broken
		expect(repairPrompt).not.toContain(`[${StructuralCheck.ScopeWithinGuardrail}]`);
	});

	test('a draft that stops before the lint still carries an empty advisories list', async () => {
		const cwd = setupConsumerRepo();

		seedPlanWorkspace({ cwd, name: 'rate-limited' });

		const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };
		const result = await runPlanDraft({ cwd, driver, name: 'rate-limited' });

		expectStatus(result, 'paused-rate-limit');
		// advisories ride every member, so a caller prints them without first
		// asking which way the draft ended
		expect(result.advisories).toStrictEqual([]);
	});
});
