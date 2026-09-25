import { describe, expect, jest, test } from '@jest/globals';
import { buildActivityTree } from '#src/activity/buildActivityTree.ts';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { createActivityRecorder } from '#src/activity/createActivityRecorder.ts';
import { readActivityMarks } from '#src/activity/readActivityMarks.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';
import type { DecisionsRecord } from '#src/contracts/plan/decisions/DecisionsRecord.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { SyncedPlanFile } from '#src/plan/common/types/SyncedPlanFile.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { dirtyPlanBody } from '#tests/helpers/dirtyPlanBody.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { createRepairDriver, runRepairLoop, setupRepairDraft } from '#tests/helpers/repairDraftFixture.ts';

// Mocked Imports
// -------------------------
/** The sync runner as the repair loop calls it: the draft's own paths and the record it was started from. */
interface SyncParams {
	cwd: string;
	name: string;
	planPaths?: string[];
	decisions?: DecisionsRecord;
}

const mockSyncPlanDecisions = jest.fn<(params: SyncParams) => Promise<{ status: 'complete'; files: SyncedPlanFile[] }>>();

// The barrel re-exports this file, so both import styles reach the double.
jest.mock('#src/plan/decisionLog/syncPlanDecisions.ts', () => ({
	syncPlanDecisions: (params: SyncParams) => mockSyncPlanDecisions(params),
}));
// -------------------------

// What the repair loop writes into the activity record: one pass level per round
// it actually spends, each holding that round's one spawn, and each closed with
// how that round's call settled. The loop's own convergence is the sibling
// suites' subject — here only the recorded shape and those outcomes are read.

/**
 * A drafted plan over an already-open command-run level, answered by a repairer
 * that rewrites the plan with `bodies` in call order — or that meets the
 * rate-limit wall on every call when `parked` is set.
 *
 * Every round syncs the Decision Log before it lints. What that sync does is the
 * decision-log suite's subject; here it only stands in, so no case's fixture
 * body is rewritten out from under the lint the rounds are counted against.
 */
const setupRepairActivity = ({ body, bodies = [], parked = false }: { body: string; bodies?: string[]; parked?: boolean }) => {
	mockSyncPlanDecisions.mockResolvedValue({ status: 'complete', files: [] });

	const draft = setupRepairDraft({ body });
	const driver = parked ? createRepairDriver({ respond: () => ({ text: '', exitCode: 1, rateLimited: true }) }) : createRepairDriver({ bodies });
	const plan = createActivityRecorder({ dir: draft.workspaceDir, level: ActivityLevelKind.Plan, label: 'demo' });
	const level = plan.open({ level: ActivityLevelKind.CommandRun, label: 'plan draft' });

	return { level, workspaceDir: draft.workspaceDir, loop: { ...draft, driver, level } };
};

/** Close the command run, let every mark reach disk, and answer the folded command-run node. */
const readCommandRun = async ({ level, workspaceDir }: { level: ActivityLevel; workspaceDir: string }): Promise<ActivityNode> => {
	level.close({ outcome: RunStatus.Passed });
	await level.settled();

	const { roots } = buildActivityTree({ plan: 'demo', marks: await readActivityMarks({ dir: workspaceDir }) });
	const commandRun = roots[0]?.children[0];

	expectDefined(commandRun);

	return commandRun;
};

/** Each pass level under the command run as the row a report would draw it: its label, its outcome, and the steps hanging off it. */
const repairRows = ({ node }: { node: ActivityNode }) =>
	node.children
		.filter(({ level }) => level === ActivityLevelKind.Pass)
		.map(({ label, outcome, children }) => ({
			label,
			outcome,
			steps: children.map((step) => ({ level: step.level, label: step.label, outcome: step.outcome })),
		}));

describe('repairPlanStructure activity levels', () => {
	test('each repair round is its own pass level holding that round’s one spawn', async () => {
		// 2 → 1 → 0 findings: every round is real progress, so both rounds run
		const { level, loop, workspaceDir } = setupRepairActivity({
			body: dirtyPlanBody({ markers: 'TBD TODO' }),
			bodies: [dirtyPlanBody({ markers: 'TBD' }), cleanPlanBody()],
		});

		const result = await runRepairLoop(loop);
		const commandRun = await readCommandRun({ level, workspaceDir });

		expectStatus(result, 'complete');
		// Two rounds, two rows, and each row's label carries the same number as the
		// transcript its spawn wrote — which is what makes a row in the report and
		// a file in the plan folder findable from each other. Collapsed into one
		// row, the report could not say which round burned the time.
		expect(repairRows({ node: commandRun })).toStrictEqual([
			{
				label: 'structural repair 1',
				outcome: RunStatus.Passed,
				steps: [{ level: ActivityLevelKind.Step, label: 'repair-1', outcome: RunStatus.Passed }],
			},
			{
				label: 'structural repair 2',
				outcome: RunStatus.Passed,
				steps: [{ level: ActivityLevelKind.Step, label: 'repair-2', outcome: RunStatus.Passed }],
			},
		]);
	});

	test('a draft that lints clean opens no pass level at all', async () => {
		const { level, loop, workspaceDir } = setupRepairActivity({ body: cleanPlanBody() });

		const result = await runRepairLoop(loop);
		const commandRun = await readCommandRun({ level, workspaceDir });

		expectStatus(result, 'complete');
		// The lint spends no agent, so there is nothing for a row to report. An
		// empty pass row here would bill a repair that never ran.
		expect({ findings: result.findings, children: commandRun.children }).toStrictEqual({ findings: [], children: [] });
	});

	test('a round that hits the rate-limit wall closes parked rather than failed', async () => {
		const { level, loop, workspaceDir } = setupRepairActivity({ body: dirtyPlanBody({ markers: 'TBD' }), parked: true });

		const result = await runRepairLoop(loop);
		const commandRun = await readCommandRun({ level, workspaceDir });

		expectStatus(result, 'paused-rate-limit');
		// The wall is a resumable state the engine already spells that way, so the
		// row has to say so: recorded as a failure, the report would send a human
		// hunting a defect where the answer is to re-run later.
		expect(repairRows({ node: commandRun })).toStrictEqual([
			{
				label: 'structural repair 1',
				outcome: RunStatus.PausedRateLimit,
				steps: [{ level: ActivityLevelKind.Step, label: 'repair-1', outcome: RunStatus.PausedRateLimit }],
			},
		]);
	});
});
