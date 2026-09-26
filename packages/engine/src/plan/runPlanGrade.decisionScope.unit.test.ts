import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';
import { DecisionSource } from '#src/contracts/plan/decisions/DecisionSource.ts';
import { DecisionsRecord } from '#src/contracts/plan/decisions/DecisionsRecord.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import { syncPlanDecisions } from '#src/plan/decisionLog/syncPlanDecisions.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import {
	closingVerdict,
	countOf,
	gapCheckMarker,
	historyScopes,
	omittedDecisionGap,
	readerPhases,
	recheckMarker,
	setupGraded,
} from '#tests/helpers/gradedThreePhasePlan.ts';

// How far a re-grade reaches when the only change since the last pass is a
// recorded decision: the phases the decision names and the phases connected to
// them, the whole plan when it names none, and never the recorded passing
// review — a decision that has not been synced into the overview stops the pass
// before the scope rule reads anything.

/** The text each phase file alone carries, so a prompt that holds one names the phase it was given. */
const phaseMarkers = [
	{ marker: 'src/alpha-thing.ts', file: 'phase1-core.md' },
	{ marker: 'src/beta-thing.ts', file: 'phase2-extra.md' },
	{ marker: 'src/gamma-thing.ts', file: 'phase3-final.md' },
];

/** The plan file each re-verification judge in a collector was asked about, one entry per judge, sorted because the judges spawn concurrently. */
const recheckedPhases = ({ invocations }: { invocations: DriverInvocation[] }): string[] =>
	invocations
		.filter(({ prompt }) => prompt.includes(recheckMarker))
		.map(({ prompt }) => phaseMarkers.find(({ marker }) => prompt.includes(marker))?.file ?? 'no phase file')
		.sort();

/** The answer a repair records: the question the open finding asked, settled, and naming the phase files it concerns when the case gives any. */
const decisionRow = ({ phases }: { phases?: string[] }): DecisionRow => ({
	source: DecisionSource.Converge,
	question: 'What does the new module return on failure?',
	options: 'throw / return null',
	choice: 'Return null and let the caller decide.',
	rationale: 'Every caller already handles a missing value.',
	assumption: false,
	...(phases === undefined ? {} : { phases }),
});

interface SetupParams {
	name: string;
	/** The findings every reader returns on the BASELINE pass — cleared before the act, the way a repair clears them. */
	gaps?: unknown[];
	/** What the re-verification judge answers during the act. Absent leaves every open record open. */
	recheckVerdict?: unknown;
	/** The phase files the appended decision names. Absent appends a row that names none. */
	phases?: string[];
	/** Whether the Decision Log is synced from the record after the row is appended. */
	synced?: boolean;
}

/**
 * The three-phase plan graded once, then one decision appended to its
 * `decisions.json` and — unless the case is about a stale log — synced into the
 * overview. No phase file's own text is touched, so the decision is the only
 * change the act's pass can see.
 */
const setupDecided = async ({ name, gaps = [], recheckVerdict, phases, synced = true }: SetupParams) => {
	const graded = await setupGraded({ name, gaps, recheckVerdict });
	const decisionsPath = join(await planWorkspaceDir({ cwd: graded.cwd, name }), 'decisions.json');
	const record = DecisionsRecord.parse(JSON.parse(readFileSync(decisionsPath, 'utf8')));

	writeFileSync(decisionsPath, JSON.stringify({ ...record, decisions: [...record.decisions, decisionRow({ phases })] }));

	if (synced) {
		const sync = await syncPlanDecisions({ cwd: graded.cwd, name });

		if ('error' in sync) {
			throw new Error(`the fixture's decision sync failed: ${sync.error}`);
		}
	}

	return graded;
};

describe('runPlanGrade', () => {
	test('plan grade: a synced decision about one phase reads that phase and its connected neighbour only', async () => {
		const { cwd, name, driver, invocations } = await setupDecided({ name: 'decision-focused', gaps: [omittedDecisionGap], phases: ['phase2-extra.md'] });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// the overview moved only inside its Decision Log, and the new row names
		// phase 2; phase 1 is read because phase 2 consumes what it hands forward,
		// and phase 3 shares nothing with either
		expect(readerPhases({ invocations })).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
		expect(countOf({ invocations, marker: gapCheckMarker })).toBe(6);
		expect(result.grade.scope).toBe('focused');
		expect(result.grade.focusedOn).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
	});

	test('plan grade: a synced decision that names no phases forces a full review', async () => {
		const { cwd, name, driver, invocations } = await setupDecided({ name: 'decision-unplaced', gaps: [omittedDecisionGap] });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// a decision that names no phase may reach any of them, so nothing bounds it
		expect(readerPhases({ invocations })).toStrictEqual(['phase1-core.md', 'phase2-extra.md', 'phase3-final.md']);
		expect(result.grade.scope).toBe('full');
		expect(result.grade.focusedOn).toStrictEqual([]);
	});

	test('plan grade: a cleared focused pass chosen from a decision change ends the invocation and may pass', async () => {
		const { cwd, name, driver, invocations, historyPath } = await setupDecided({
			name: 'decision-cleared',
			gaps: [omittedDecisionGap],
			recheckVerdict: closingVerdict,
			phases: ['phase2-extra.md'],
		});

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// six readers for the decision's closure and no whole-plan fan-out behind
		// them: the phase neither the decision nor its neighbour reaches is covered
		// at the text it still carries, so the pass that read the change approves
		expect(countOf({ invocations, marker: gapCheckMarker })).toBe(6);
		expect(historyScopes({ historyPath })).toStrictEqual(['full', 'focused']);
		expect(result.grade.scope).toBe('focused');
		expect(result.grade.passed).toBe(true);
	});

	test('plan grade: a focused pass chosen from a decision change re-verifies every open record', async () => {
		const { cwd, name, driver, invocations } = await setupDecided({ name: 'decision-rechecked', gaps: [omittedDecisionGap], phases: ['phase2-extra.md'] });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		expect(result.grade.scope).toBe('focused');
		// the readers stop at the decision's reach, but every question the baseline
		// left open is asked again — three lenses on each phase, phase 3 included
		expect(recheckedPhases({ invocations })).toStrictEqual([
			'phase1-core.md',
			'phase1-core.md',
			'phase1-core.md',
			'phase2-extra.md',
			'phase2-extra.md',
			'phase2-extra.md',
			'phase3-final.md',
			'phase3-final.md',
			'phase3-final.md',
		]);
	});

	test('plan grade: a changed decision is never answered by the recorded passing full review', async () => {
		const { cwd, name, driver, invocations } = await setupDecided({ name: 'decision-not-reused', phases: ['phase2-extra.md'] });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// the baseline review passed, but it was measured against a record without
		// this decision, so it no longer speaks for the current inputs
		expect('reused' in result && result.reused).toBeFalsy();
		// and with nothing open the pass still narrows: the decision reaches the
		// second phase and the file it shares with the first, and no further
		expect(readerPhases({ invocations })).toStrictEqual(['phase1-core.md', 'phase2-extra.md']);
		expect(result.grade.scope).toBe('focused');
	});

	test('plan grade: an unsynced decision stops on the Decision Log check before any reader is spawned', async () => {
		const { cwd, name, driver, invocations } = await setupDecided({
			name: 'decision-unsynced',
			gaps: [omittedDecisionGap],
			phases: ['phase2-extra.md'],
			synced: false,
		});

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// the overview's log no longer matches the record, which gates the pass
		expect(result.grade.structural).toEqual(
			expect.arrayContaining([expect.objectContaining({ check: 'decision-log-current', severity: 'blocking', phase: 'overview.md' })]),
		);
		// so the scope rule never runs past it — no reader and no re-verification judge
		expect(invocations).toStrictEqual([]);
	});
});
