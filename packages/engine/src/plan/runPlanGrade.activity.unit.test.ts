import { describe, expect, test } from '@jest/globals';
import type { ActivityLevel } from '#src/activity/index.ts';
import { ActivityLevelKind, type RunStatus } from '#src/contracts/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { closingVerdict, declaredDocs, omittedDecisionGap, setupGraded } from '#tests/helpers/gradedThreePhasePlan.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// Where a grade's spawns hang in the activity record: which level each pass gets
// of its own, and which level every agent call attaches to.

/** One level a grade opened, as the recording handle saw it. */
interface RecordedLevel {
	id: string;
	kind: ActivityLevelKind;
	label: string;
	children: RecordedLevel[];
	outcome?: RunStatus;
}

/**
 * A level handle that records the tree opened beneath it instead of writing a
 * file.
 *
 * The handle is the seam `runPlanGrade` is handed, so what it was asked to open
 * — and which level each child was opened on — is the observable behaviour this
 * phase adds. Ids are derived from the path to the node so the tree stays
 * deterministic without any shared counter.
 */
const recordingHandle = ({ node }: { node: RecordedLevel }): ActivityLevel => ({
	id: node.id,
	open: ({ level, label }) => {
		const child: RecordedLevel = { id: `${node.id}/${node.children.length}`, kind: level, label, children: [] };

		node.children.push(child);

		return recordingHandle({ node: child });
	},
	close: ({ outcome }) => {
		node.outcome = node.outcome ?? outcome;
	},
	recordProcess: () => undefined,
	settled: async () => undefined,
});

/** A command-run level and the handle a caller threads into the grade. */
const openCommandRun = (): { level: ActivityLevel; commandRun: RecordedLevel } => {
	const commandRun: RecordedLevel = { id: 'command-run', kind: ActivityLevelKind.CommandRun, label: 'plan grade', children: [] };

	return { level: recordingHandle({ node: commandRun }), commandRun };
};

/** The labels of the step-kind children one level holds — every agent call attached directly to it. */
const stepLabelsOf = ({ level }: { level: RecordedLevel }): string[] => level.children.filter(({ kind }) => kind === 'step').map(({ label }) => label);

/** Which of the three phase files a level's own reader steps covered, in deliverable order. */
const readerPhasesOf = ({ level }: { level: RecordedLevel }): string[] =>
	['phase1-core', 'phase2-extra', 'phase3-final'].filter((phase) => stepLabelsOf({ level }).some((label) => label.includes(`grade-${phase}-`)));

/**
 * A three-phase plan whose focused pass closes every open record, so the full
 * review a cleared focused pass earns runs in the same invocation.
 */
const setupClearedFocusedPass = async () => {
	const graded = await setupGraded({
		name: 'focused-then-full',
		gaps: [omittedDecisionGap],
		recheckVerdict: closingVerdict,
		edited: 'phase2-extra.md',
	});

	return { ...graded, ...openCommandRun() };
};

/**
 * A first-graded single plan in a repo declaring a documentation surface, whose
 * readers return a finding — so one full pass spawns all three kinds of agent:
 * the readers, the whole-plan documentation checker and the judge.
 */
const setupFullPassWithDocs = () => {
	const name = 'one-full-pass';
	const cwd = setupConsumerRepo({ config: { docs: declaredDocs } });

	writePlanDeliverable({ cwd, name, body: cleanPlanBody({ title: 'Graded Plan', documentation: 'Nothing user-facing — no docs needed.' }) });

	return { cwd, name, driver: createGapCheckDriver({ gaps: [omittedDecisionGap] }), ...openCommandRun() };
};

describe('runPlanGrade', () => {
	test('a focused pass and the full review it earns are two pass levels', async () => {
		const { cwd, name, driver, level, commandRun } = await setupClearedFocusedPass();

		const result = await runPlanGrade({ cwd, driver, name, level });

		expectStatus(result, 'complete');
		// two passes ran in one invocation, so the command run holds two rows
		expect(commandRun.children.map(({ kind }) => kind)).toStrictEqual(['pass', 'pass']);
		expect(commandRun.children.map(({ label }) => label)).toEqual([expect.stringContaining('focused'), expect.stringContaining('full')]);
		// and each pass holds its OWN readers: the focused one read the repair's
		// closure, the full review it earned read the whole plan
		expect(commandRun.children.map((pass) => readerPhasesOf({ level: pass }))).toStrictEqual([
			['phase1-core', 'phase2-extra'],
			['phase1-core', 'phase2-extra', 'phase3-final'],
		]);
	});

	test('readers, the documentation checker and the judges are steps of their pass', async () => {
		const { cwd, name, driver, level, commandRun } = setupFullPassWithDocs();

		const result = await runPlanGrade({ cwd, driver, name, level });

		expectStatus(result, 'complete');

		const pass: RecordedLevel | undefined = commandRun.children[0];

		expectDefined(pass);
		// nothing this pass spawned hangs from the command run itself
		expect(commandRun.children.map(({ kind }) => kind)).toStrictEqual(['pass']);
		expect(stepLabelsOf({ level: commandRun })).toStrictEqual([]);
		// every one of them is a step of the pass that spawned it
		expect(stepLabelsOf({ level: pass })).toEqual(
			expect.arrayContaining([
				expect.stringContaining('grade-plan-surface'),
				expect.stringContaining('grade-plan-wiring'),
				expect.stringContaining('grade-plan-decisions'),
				expect.stringContaining('grade-documentation'),
				expect.stringContaining('grade-judge-0'),
			]),
		);
	});
});
