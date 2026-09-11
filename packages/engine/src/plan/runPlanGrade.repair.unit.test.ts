import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type GradeInputs, GradeMemory } from '#src/contracts/index.ts';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { gradeMemoryPath } from '#src/plan/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { omittedDecisionGap, recheckMarker, setupGraded } from '#tests/helpers/gradedThreePhasePlan.ts';

// What carries a repair forward in `plan grade`: a focused pass that finished
// every check its own scope called for becomes the baseline the next repair
// narrows against — without approving anything, without hiding a finding on a
// phase it skipped, and without surviving a change to the code beside the plan.

/** The persisted memory, read the way the next pass reads it. */
const readMemory = ({ cwd, name }: { cwd: string; name: string }): GradeMemory =>
	GradeMemory.parse(JSON.parse(readFileSync(gradeMemoryPath({ cwd, name }), 'utf8')));

/** New text for one input that moves its content hash and changes nothing the lint or the phase graph reads. */
const repairAgain = ({ path }: { path: string }) => {
	const text = readFileSync(path, 'utf8');
	const repaired = path.endsWith('.md')
		? text.replace('## Context\n', '## Context\n\nRepaired again after the focused pass.\n')
		: `${text}// moved after the focused pass\n`;

	writeFileSync(path, repaired);
};

/** The plan files whose hash differs between two fingerprints — a file on one side only counts as moved. */
const movedPlanFiles = ({ current, previous }: { current: GradeInputs; previous: GradeInputs }): string[] => {
	const before = new Map(previous.planFiles.map(({ file, sha256 }) => [file, sha256]));
	const after = new Map(current.planFiles.map(({ file, sha256 }) => [file, sha256]));

	return [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file)).sort();
};

/** The record ids the re-verification judges in a collector were asked about. */
const recheckedIds = ({ invocations }: { invocations: DriverInvocation[] }): string[] =>
	invocations.filter(({ prompt }) => prompt.includes(recheckMarker)).map(({ prompt }) => /- record: (\S+)/.exec(prompt)?.[1] ?? '');

/**
 * The three-phase plan graded once with a finding on every phase, so a complete
 * full pass left open records and a baseline behind, then phase 2 repaired. The
 * act is that repair's focused pass; the baseline it narrows against is read
 * back first, so a case can compare the two fingerprints.
 */
const setupRepair = async ({ name }: { name: string }) => {
	const graded = await setupGraded({ name, gaps: [omittedDecisionGap], edited: 'phase2-extra.md' });
	const baseline = readMemory({ cwd: graded.cwd, name }).lastPass;

	// an absent baseline would leave nothing to compare the pass's fingerprint against
	if (baseline === undefined) {
		throw new Error("the fixture's baseline pass recorded no lastPass");
	}

	return { cwd: graded.cwd, name, driver: graded.driver, baseline };
};

/**
 * The same plan after the phase-2 repair's focused pass has run and left its
 * blockers open, then `edited` — a plan basename or a repo-relative source path —
 * changed the way a second repair would. The act is the pass after that.
 *
 * It hands back the first repair's result, the baseline that pass left in the
 * memory, and the open records raised against phases 1 and 2, which the second
 * repair to phase 3 never offers to a reader. The invocation collector is
 * cleared, so what it holds after the act is the act's own.
 */
const setupSecondRepair = async ({ name, edited }: { name: string; edited: string }) => {
	const graded = await setupGraded({ name, gaps: [omittedDecisionGap], edited: 'phase2-extra.md' });
	const first = await runPlanGrade({ cwd: graded.cwd, driver: graded.driver, name });
	const memory = readMemory({ cwd: graded.cwd, name });
	const skipped = memory.findings.filter(({ status, phase }) => status === 'open' && phase !== 'phase3-final.md').map(({ id, phase }) => ({ id, phase }));

	// with no open record on either skipped phase, "still blocks" would hold vacuously
	if (!['phase1-core.md', 'phase2-extra.md'].every((phase) => skipped.some((record) => record.phase === phase))) {
		throw new Error('the fixture left no open record on phase 1 or phase 2');
	}

	graded.invocations.length = 0;
	repairAgain({ path: edited.endsWith('.md') ? join(dirname(graded.gradePath), edited) : join(graded.cwd, edited) });

	return { cwd: graded.cwd, name, driver: graded.driver, invocations: graded.invocations, first, baseline: memory.lastPass, skipped };
};

describe('runPlanGrade', () => {
	test('plan grade: a finished focused pass becomes the baseline the next repair narrows against', async () => {
		const { cwd, name, driver, first } = await setupSecondRepair({ name: 'repair-carried', edited: 'phase3-final.md' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(first, 'complete');
		// the first repair read phase 2 and the phase it consumes, and stayed focused —
		// a pass that cleared every blocker would have been followed by a full review
		expect(first.grade).toEqual(expect.objectContaining({ scope: 'focused', focusedOn: ['phase1-core.md', 'phase2-extra.md'] }));
		expectStatus(result, 'complete');
		// measured against the first repair's own fingerprint, only phase 3 moved:
		// phases 1 and 2 were already read as they stand and are not read again
		expect(result.grade).toEqual(expect.objectContaining({ scope: 'focused', focusedOn: ['phase3-final.md'], phasesChecked: ['phase3-final.md'] }));
	});

	test('plan grade: a focused pass that read every phase it owed records itself as the baseline', async () => {
		const { cwd, name, driver } = await setupRepair({ name: 'repair-recorded' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// every phase it owed a reader answered, and it is still no whole-plan clean bill
		expect(result.grade).toEqual(
			expect.objectContaining({
				scope: 'focused',
				phasesChecked: ['phase1-core.md', 'phase2-extra.md'],
				scopeComplete: true,
				complete: false,
				passed: false,
			}),
		);

		const memory = readMemory({ cwd, name });

		// the next repair narrows against what THIS pass measured
		expect(memory.lastPass).toEqual({ scope: 'focused', inputs: result.grade.inputs, at: expect.any(String) });
		// and a focused pass can never stand in for the review approval needs
		expect(memory.lastPassingFullReview).toBeUndefined();
	});

	test('plan grade: a finding on a phase the repair pass never reads still blocks', async () => {
		const { cwd, name, driver, invocations, skipped } = await setupSecondRepair({ name: 'repair-still-blocks', edited: 'phase3-final.md' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');
		// neither phase 1 nor phase 2 was offered to a reader this pass
		expect(result.grade.focusedOn).toStrictEqual(['phase3-final.md']);
		expect(result.grade.phasesChecked).toStrictEqual(['phase3-final.md']);
		// yet every question raised against them is still on the gap list, tied to
		// its record and carrying the outcome that blocks the grade
		expect(result.grade.gaps).toEqual(
			expect.arrayContaining(skipped.map(({ id, phase }) => expect.objectContaining({ phase, findingId: id, outcome: 'needs-a-human' }))),
		);
		// and each one was asked again against the plan as it reads now
		expect(recheckedIds({ invocations })).toEqual(expect.arrayContaining(skipped.map(({ id }) => id)));
	});

	test('plan grade: a source change after a focused pass forces a full review', async () => {
		const { cwd, name, driver, baseline } = await setupSecondRepair({ name: 'repair-code-moved', edited: 'src/alpha.js' });

		const result = await runPlanGrade({ cwd, driver, name });

		// the pass compared itself against the focused repair's fingerprint...
		expect(baseline?.scope).toBe('focused');
		expectStatus(result, 'complete');
		// ...and the code beside the plan moved since, so that reading no longer
		// speaks for any phase and every plan file is read again
		expect(result.grade).toEqual(
			expect.objectContaining({ scope: 'full', focusedOn: [], phasesChecked: ['phase1-core.md', 'phase2-extra.md', 'phase3-final.md'] }),
		);
	});

	test("plan grade: every plan file a focused pass's fingerprint moved is one it read", async () => {
		const { cwd, name, driver, baseline } = await setupRepair({ name: 'repair-fingerprint' });

		const result = await runPlanGrade({ cwd, driver, name });

		expectStatus(result, 'complete');

		const recorded = readMemory({ cwd, name }).lastPass;

		expectDefined(recorded);

		const moved = movedPlanFiles({ current: recorded.inputs, previous: baseline.inputs });

		// the recorded fingerprint differs from the one it narrowed against by the
		// repaired phase alone...
		expect(moved).toStrictEqual(['phase2-extra.md']);
		// ...which this pass read, so it claims coverage of no plan text it never saw
		expect(result.grade.phasesChecked).toEqual(expect.arrayContaining(moved));
		// and no input other than plan text moved, or the pass could not have been focused
		expect({ ...recorded.inputs, planFiles: [], sha256: '' }).toStrictEqual({ ...baseline.inputs, planFiles: [], sha256: '' });
	});
});
