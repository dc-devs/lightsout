import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { DecisionRow } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { createScriptedDraftDriver, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { phaseRow, setupPhasedDraft } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The older, file-driven entry: a plan folder whose record is `facts.json` and
// `decisions.json` rather than the canonical planning store. Those folders
// predate canonical storage and still draft, so what they are owed is pinned
// here — every engine-owned section composed, and the two-stage phased fan-out
// intact. What is gone is the choice of authoring engine: there is one, and no
// caller can ask for another.

/**
 * One settled row the draft must render into `## Global Constraints`.
 *
 * The `Global constraint:` question prefix is what marks a row as binding the
 * whole plan, and the choice text is deliberately unlike anything the fixture
 * body carries, so the rendered bullet is visible by those words alone.
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
 * A plan folder of the older shape, clean against the structural lint, whose
 * saved record holds the one constraint row.
 *
 * The authored body renders its `## Decision Log` from an EMPTY record and
 * states `- None` under `## Global Constraints`, so both sections arrive stale —
 * which is what makes the composed result readable off the file.
 */
const setupFolderDraft = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name });

	const planDir = join(cwd, '.lightsout', 'plans', name);

	writeFileSync(join(planDir, 'decisions.json'), JSON.stringify({ planName: name, decisions: [constraintRow] }));

	const invocations: DriverInvocation[] = [];
	const driver = createDraftDriver({ bodies: [cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });

	return { cwd, driver, name, planDir, invocations };
};

/** The same older folder shape, with facts touching enough paths to estimate the phased variant and a harness answering every spawn the two-stage flow emits. */
const setupFolderPhasedDraft = ({ name }: { name: string }) => {
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

describe('runPlanDraft from a plan folder', () => {
	test('composes every engine-owned section from the folder’s own saved rows', async () => {
		const { cwd, driver, name, planDir } = setupFolderDraft({ name: 'folder-rows' });

		const result = await runPlanDraft({ cwd, driver, name });

		expectStatus(result, 'complete');

		const plan = readFileSync(join(planDir, 'plan.md'), 'utf8');

		// the log row and the rendered bullet together prove the folder's saved
		// record reached both engine-owned sections, rather than one of them
		expect({
			logComposed: plan.includes('| Global constraint: which runtime? |'),
			constraintsAsAuthored: plan.includes('## Global Constraints\n\n- None'),
			constraintBulletRendered: plan.includes('- Node only'),
		}).toStrictEqual({ logComposed: true, constraintsAsAuthored: false, constraintBulletRendered: true });
	});

	test('spawns the writer into the restricted environment, with no way to ask for another', async () => {
		const { cwd, driver, name, invocations } = setupFolderDraft({ name: 'folder-spawn' });

		const result = await runPlanDraft({ cwd, driver, name });

		expectStatus(result, 'complete');
		// a clean body needs no structural repair, so the writer is the whole spawn
		// set — and it reaches the harness carrying the environment request, which
		// is now the only environment a plan writer is ever spawned into
		expect(invocations.map(({ prompt, environment }) => ({ role: prompt.includes('# Draft input') ? 'writer' : 'other', environment }))).toStrictEqual([
			{ role: 'writer', environment: expect.objectContaining({ noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true }) },
		]);
	});

	test('fans a phased folder draft out from its overview, one spawn per declared phase', async () => {
		const { cwd, driver, name, planDir, calls, invocations } = setupFolderPhasedDraft({ name: 'folder-phased' });

		const result = await runPlanDraft({ cwd, driver, name });

		expectStatus(result, 'complete');
		// One overview spawn, then one spawn per declared phase, and both files on
		// disk: the two-stage flow an older plan folder still reaches.
		expect({
			variant: result.variant,
			roles: calls.map(({ role }) => role),
			planPaths: result.planPaths,
			overview: existsSync(join(planDir, 'overview.md')),
			phase: existsSync(join(planDir, 'phase1-core.md')),
		}).toStrictEqual({
			variant: 'overview',
			roles: ['overview', 'phase'],
			planPaths: [join(planDir, 'overview.md'), join(planDir, 'phase1-core.md')],
			overview: true,
			phase: true,
		});
		expect(invocations.map(({ environment }) => environment !== undefined)).toStrictEqual(invocations.map(() => true));
	});
});
