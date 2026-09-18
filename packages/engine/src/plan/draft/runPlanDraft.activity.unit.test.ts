import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type ActivityLevel, buildActivityTree, createActivityRecorder, readActivityMarks } from '#src/activity/index.ts';
import { ActivityLevelKind, type ActivityNode, DraftImplementation } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { createScriptedDraftDriver, unchangedFixReport } from '#tests/helpers/createScriptedDraftDriver.ts';
import { dirtyPlanBody } from '#tests/helpers/dirtyPlanBody.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { phaseRow, setupPhasedDraft } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';

// What a draft writes into the activity record: which levels it opens, and which
// level each spawn ends up under. The draft's own outcome is other suites'
// subject — here only the recorded shape is read.

/** The two phases the overview declares, so a fan-out row has more than one step to hold. */
const declaredRows = [phaseRow({ number: 1, file: 'phase1-core.md' }), phaseRow({ number: 2, file: 'phase2-wire.md' })];

/** One phase file's body, its created path named after the phase file so two phase writers never claim to create one path. */
const phaseDraftBody = ({ file }: { file: string }) => cleanPlanBody({ reference: true }).replaceAll('src/new-thing.ts', `src/${file.replace('.md', '')}.ts`);

/** A plan-kind record in a directory of its own, and the command-run level a plan subcommand would hand the runner. */
const openCommandRun = ({ name }: { name: string }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-draft-activity-'));
	const plan = createActivityRecorder({ dir, level: ActivityLevelKind.Plan, label: name });

	return { dir, level: plan.open({ level: ActivityLevelKind.CommandRun, label: 'plan draft' }) };
};

/** A phased draft over an open command-run level, answered by a harness that authors a clean overview and one clean file per declared phase. */
const setupPhasedDraftActivity = ({ name }: { name: string }) => {
	const draft = setupPhasedDraft({ name });
	const driver = createScriptedDraftDriver({
		respond: ({ role, path, file }) =>
			role === 'overview' ? overviewBody({ rows: declaredRows }) : role === 'phase' ? phaseDraftBody({ file }) : unchangedFixReport({ path }),
	});

	return { ...draft, ...openCommandRun({ name }), driver };
};

/**
 * A single draft whose closing lint takes two repair rounds to clear.
 *
 * A substantially different arrangement from the phased factory above, so it is
 * a factory of its own: the three bodies are answered in spawn order, and what
 * makes the loop spend a second round is that the first repair swaps one
 * placeholder for a different one — an unchanged finding set would stop it after
 * a single round.
 */
const setupRepairDraftActivity = ({ name }: { name: string }) => {
	const draft = setupPhasedDraft({ name, touching: 0 });
	const driver = createDraftDriver({ bodies: [dirtyPlanBody({ markers: 'TBD' }), dirtyPlanBody({ markers: 'TODO' }), cleanPlanBody()] });

	return { ...draft, ...openCommandRun({ name }), driver };
};

/**
 * A focused draft over an open command-run level, against the one registered
 * harness that cannot provide a control the focused environment asks for — so
 * the run is refused before any agent is spawned.
 *
 * A factory of its own because the arrangement differs in what answers the
 * harness rather than in a parameter: the driver is an ordinary working author
 * renamed, so a run the preflight failed to refuse would draft normally and the
 * assertion would see the missing refusal rather than a stub that could not
 * write.
 */
const setupRefusedDraftActivity = ({ name }: { name: string }) => {
	const draft = setupPhasedDraft({ name, touching: 0 });
	const driver: Driver = { ...createDraftDriver({ bodies: [cleanPlanBody()] }), name: 'omp' };

	return { ...draft, ...openCommandRun({ name }), driver };
};

/** The command-run node of the record written into `dir`, once every queued mark has reached disk. */
const readCommandRun = async ({ dir, level }: { dir: string; level: ActivityLevel }): Promise<ActivityNode> => {
	await level.settled();

	const { roots } = buildActivityTree({ plan: 'draft', marks: await readActivityMarks({ dir }) });
	const commandRun = roots[0]?.children[0];

	expectDefined(commandRun);

	return commandRun;
};

/** The step levels opened directly on a node — the spawns that answer to it rather than to a grouping under it. */
const stepLabels = ({ node }: { node: ActivityNode }) => node.children.filter(({ level }) => level === ActivityLevelKind.Step).map(({ label }) => label);

/**
 * Every pass level under `node` holding steps of the given name, each as its own
 * step labels — one entry per row the report would draw.
 *
 * The labels of one pass are sorted because a fan-out's spawns start at once,
 * and which of them opened its level first is not what any of this claims. The
 * passes themselves are left in the order they were opened, which for repair
 * rounds is the order they ran in.
 */
const passRounds = ({ node, step }: { node: ActivityNode; step: string }) =>
	node.children
		.filter(({ level }) => level === ActivityLevelKind.Pass)
		.map((pass) => stepLabels({ node: pass }).sort())
		.filter((labels) => labels.some((label) => label.startsWith(step)));

describe('runPlanDraft activity levels', () => {
	test('the phase fan-out is one pass level holding one step per phase', async () => {
		const { cwd, dir, driver, level, name } = setupPhasedDraftActivity({ name: 'fan-out-levels' });

		await runPlanDraft({ cwd, driver, name, level });

		const commandRun = await readCommandRun({ dir, level });

		// The overview spawn is the command run's own step, and the two phase
		// writers are steps of one fan-out row beneath it. Attached to the command
		// run instead, the report could never say what the fan-out cost as against
		// what the overview did.
		expect({ steps: stepLabels({ node: commandRun }), fanOuts: passRounds({ node: commandRun, step: 'draft-phase' }) }).toStrictEqual({
			steps: ['draft'],
			fanOuts: [['draft-phase1', 'draft-phase2']],
		});
	});

	test('each structural repair attempt is its own pass level', async () => {
		const { cwd, dir, driver, level, name } = setupRepairDraftActivity({ name: 'repair-levels' });

		await runPlanDraft({ cwd, driver, name, level });

		const commandRun = await readCommandRun({ dir, level });

		// Two rounds, two rows. Collapsed into one, the report could not say which
		// attempt burned the time, which is the whole reason a round is a level of
		// its own rather than two spawns under one.
		expect({ steps: stepLabels({ node: commandRun }), rounds: passRounds({ node: commandRun, step: 'repair-' }) }).toStrictEqual({
			steps: ['draft'],
			rounds: [['repair-1'], ['repair-2']],
		});
	});

	test('a legacy draft records the same level shape as a focused one', async () => {
		const { cwd, dir, driver, level, name } = setupPhasedDraftActivity({ name: 'legacy-levels' });

		await runPlanDraft({ cwd, driver, name, level, implementation: DraftImplementation.Legacy });

		const commandRun = await readCommandRun({ dir, level });

		// The same shape the focused draft above is pinned to, stated again rather
		// than shared: the flag chooses which writer runs, never what a plan run
		// records, and a legacy draft whose spawns were never wired would record a
		// command run with nothing under it at all.
		expect({ steps: stepLabels({ node: commandRun }), fanOuts: passRounds({ node: commandRun, step: 'draft-phase' }) }).toStrictEqual({
			steps: ['draft'],
			fanOuts: [['draft-phase1', 'draft-phase2']],
		});
	});

	test('a draft refused before any work opens nothing under the command run', async () => {
		const { cwd, dir, driver, level, name } = setupRefusedDraftActivity({ name: 'refused-levels' });

		const result = await runPlanDraft({ cwd, driver, name, level });

		const commandRun = await readCommandRun({ dir, level });

		// The refusal returns before the context is built, so the level it was
		// handed is carried and never opened on. A run that spent nothing must
		// leave no pass, no step and no process behind to be totalled — otherwise
		// the report bills a refusal as work.
		expect({ status: result.status, children: commandRun.children, processes: commandRun.processes }).toStrictEqual({
			status: 'failed',
			children: [],
			processes: [],
		});
	});
});
