import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';
import { DraftImplementation } from '#src/contracts/plan/draft/DraftImplementation.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { createScriptedDraftDriver, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { phaseRow, setupPhasedDraft } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// What a legacy draft must keep doing once the focused implementation becomes
// the default: its repair round composes the Decision Log and nothing else, its
// writer spawn asks the harness for no environment at all, and its two-stage
// phased flow still fans out from an overview.

/**
 * One settled row every draft renders into `## Global Constraints`, composed
 * from the record by the same command the currency check names as its remedy.
 *
 * The `Global constraint:` question prefix is what marks a row as binding the
 * whole plan, and the choice text is deliberately unlike anything the fixture
 * body carries, so a regenerated bullet would be visible by those words alone.
 */
const constraintRow: DecisionRow = {
	source: 'Elicitation',
	question: 'Global constraint: which runtime?',
	options: 'node only / node and the browser',
	choice: 'Node only',
	rationale: 'the engine never runs in a browser',
	assumption: false,
};

/**
 * A legacy single draft over a repo the structural lint is clean against, whose
 * saved record holds the one constraint row.
 *
 * The authored body renders its `## Decision Log` from an EMPTY record and its
 * `## Global Constraints` from one too, so both sections arrive stale against a
 * record holding the one constraint row. What the draft rewrites is then the
 * whole answer.
 */
const setupLegacyDraft = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name });

	const planDir = planWorkspaceFolder({ cwd: cwd, name: name });

	writeFileSync(join(planDir, 'decisions.json'), JSON.stringify({ planName: name, decisions: [constraintRow] }));

	const invocations: DriverInvocation[] = [];
	const driver = createDraftDriver({ bodies: [cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });

	return { cwd, driver, name, planDir, invocations };
};

/**
 * A legacy draft of a plan the estimate reads as phased: facts touching enough
 * paths for the overview variant, and a scripted harness answering every spawn
 * shape the two-stage flow can emit.
 *
 * A substantially different arrangement from the single draft above, so it is a
 * factory of its own: the phased flow is reached only by the estimate, and the
 * legacy one is reached only by typing the flag, so nothing else in the suite
 * runs it at all.
 */
const setupLegacyPhasedDraft = ({ name }: { name: string }) => {
	const draft = setupPhasedDraft({ name });
	const invocations: DriverInvocation[] = [];
	const driver = recordingDriver({
		driver: createScriptedDraftDriver({
			onCall: (call) => draft.calls.push(call),
			respond: ({ role, path }) =>
				role === 'overview' ? overviewBody({ rows: [phaseRow()] }) : role === 'phase' ? cleanPlanBody({ reference: true }) : unchangedFixReport({ path }),
		}),
		invocations,
	});

	return { ...draft, driver, invocations };
};

describe('runPlanDraft legacy implementation', () => {
	test("leaves a legacy convergence's repair rounds unchanged", async () => {
		const { cwd, driver, name, planDir } = setupLegacyDraft({ name: 'legacy-rounds' });

		const result = await runPlanDraft({ cwd, driver, name, implementation: DraftImplementation.Legacy });

		expectStatus(result, 'complete');

		const plan = readFileSync(join(planDir, 'plan.md'), 'utf8');

		// the log row and the rendered bullet prove the round composed both sections
		// the decision record owns, which is what `plan sync-decisions` writes and
		// therefore what a legacy convergence gets; the authored `- None` is gone
		expect({
			logComposed: plan.includes('| Global constraint: which runtime? |'),
			constraintsAsAuthored: plan.includes('## Global Constraints\n\n- None'),
			constraintBulletRendered: plan.includes('- Node only'),
		}).toStrictEqual({ logComposed: true, constraintsAsAuthored: false, constraintBulletRendered: true });
	});

	test("leaves a legacy spawn's driver invocation unchanged", async () => {
		const { cwd, driver, name, invocations } = setupLegacyDraft({ name: 'legacy-spawn' });

		const result = await runPlanDraft({ cwd, driver, name, implementation: DraftImplementation.Legacy });

		expectStatus(result, 'complete');
		// a clean body needs no repair, so the writer is the whole spawn set — and
		// it reaches the harness carrying no environment request, exactly as it did
		// before the focused implementation existed
		expect(invocations.map(({ prompt, environment }) => ({ role: prompt.includes('# Draft input') ? 'writer' : 'other', environment }))).toStrictEqual([
			{ role: 'writer', environment: undefined },
		]);
	});

	test('fans a legacy phased draft out from its overview, asking for no environment on either stage', async () => {
		const { cwd, driver, name, planDir, calls, invocations } = setupLegacyPhasedDraft({ name: 'legacy-phased' });

		const result = await runPlanDraft({ cwd, driver, name, implementation: DraftImplementation.Legacy });

		expectStatus(result, 'complete');
		// One overview spawn, then one spawn per declared phase, and both files on
		// disk: the two-stage flow the flag has to keep reaching, spawning exactly
		// what it spawned before the focused implementation took the default.
		expect({
			variant: result.variant,
			roles: calls.map(({ role }) => role),
			planPaths: result.planPaths,
			overview: existsSync(join(planDir, 'overview.md')),
			phase: existsSync(join(planDir, 'phase1-core.md')),
			environments: invocations.map(({ environment }) => environment),
		}).toStrictEqual({
			variant: 'overview',
			roles: ['overview', 'phase'],
			planPaths: [join(planDir, 'overview.md'), join(planDir, 'phase1-core.md')],
			overview: true,
			phase: true,
			environments: [undefined, undefined],
		});
	});
});
