import { describe, expect, test } from '@jest/globals';
import { GradeFindingStatus, type GradeInputs } from '#src/contracts/index.ts';
import { decideGradeScope } from '#src/plan/common/scope/decideGradeScope.ts';
import { getDecisionReach } from '#src/plan/common/scope/getDecisionReach.ts';
import { findingRecord, inputsFor, memoryFor, phasedFiles, phasedPlanFiles, soloPhaseFile } from '#tests/helpers/gradeScopeInputs.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';

/** The decision row both passes carry unchanged. It names no phase, as a brainstorm row never does, so it widens the pass only if it is read as changed. */
const settledRow = { sha256: 'row-settled', questionSha256: 'question-settled' };

/** The three-phase plan every fixture here grades: the third phase shares no path, export or hand-off with the first two, so a closure from either stops short of it. */
const threePhasePlan = () => ({
	files: [...phasedFiles(), soloPhaseFile()],
	overviewText: overviewBody({
		rows: [
			{ number: 1, file: 'phase1-core.md', creates: ['src/core.ts'] },
			{ number: 2, file: 'phase2-extra.md' },
			{ number: 3, file: 'phase3-solo.md', creates: ['src/solo.ts'] },
		],
	}),
});

/** The plan-file hashes of the three-phase plan; the first phase's hash and the overview's are the two a pass moves. */
const planFilesFor = ({ phaseOne, overview }: { phaseOne: string; overview: string }) => [
	...phasedPlanFiles({ phaseOne, overview }),
	{ file: 'phase3-solo.md', sha256: 'phase3-1' },
];

/** One open question on the first phase, so the pass is a repair check rather than an approval review. */
const openMemoryFor = ({ previous }: { previous: GradeInputs }) =>
	memoryFor({ findings: [findingRecord({ id: 'f1', phase: 'phase1-core.md', status: GradeFindingStatus.Open })], lastPass: previous });

interface DecisionChangeSpec {
	/** Leave the added row's `phases` out, so its reach is not established. */
	namesNoPhase?: boolean;
	/** Move the overview's design hash as well, as an edit outside its Decision Log would. */
	designMoved?: boolean;
}

/**
 * A three-phase plan mid-repair, just after `sync-decisions`: one question open,
 * no phase text edited, and one decision row added that names the second phase.
 * The overview's bytes moved because its Decision Log did; its text outside the
 * log did not. Each knob turns off exactly one condition a decision-seeded
 * focused pass needs. `reachError` is what `getDecisionReach` answers for these
 * very parts, so a test can check the full-review reason carries it.
 */
const setupDecisionChange = ({ namesNoPhase = false, designMoved = false }: DecisionChangeSpec = {}) => {
	const addedRow = { sha256: 'row-added', questionSha256: 'question-added', ...(namesNoPhase ? {} : { phases: ['phase2-extra.md'] }) };
	const previous = inputsFor({
		planFiles: planFilesFor({ phaseOne: 'phase1-1', overview: 'overview-1' }),
		sha256: 'inputs-previous',
		decisionRows: [settledRow],
	});
	const inputs = inputsFor({
		planFiles: planFilesFor({ phaseOne: 'phase1-1', overview: 'overview-2' }),
		sha256: 'inputs-current',
		design: designMoved ? 'design-2' : 'design-1',
		decisionRows: [settledRow, addedRow],
	});
	const reach = getDecisionReach({
		current: inputs.decisionLog,
		previous: previous.decisionLog,
		overviewChanged: true,
		edited: [],
		phaseFiles: ['phase1-core.md', 'phase2-extra.md', 'phase3-solo.md'],
	});

	return {
		params: { ...threePhasePlan(), memory: openMemoryFor({ previous }), inputs, narrowed: false },
		reachError: 'error' in reach ? reach.error : 'getDecisionReach placed the row',
	};
};

/**
 * The focusable fixture of the scope rule's own suite — the first phase edited,
 * one question open, the overview untouched — whose earlier pass was recorded
 * before the fingerprint carried a decision-log part. Every other condition for
 * a focused pass holds, so only the missing part can widen it.
 */
const setupLegacyBaseline = () => {
	const previous = inputsFor({
		planFiles: planFilesFor({ phaseOne: 'phase1-1', overview: 'overview-1' }),
		sha256: 'inputs-previous',
		omitDecisionLog: true,
	});
	const inputs = inputsFor({ planFiles: planFilesFor({ phaseOne: 'phase1-2', overview: 'overview-1' }), sha256: 'inputs-current' });

	return { ...threePhasePlan(), memory: openMemoryFor({ previous }), inputs, narrowed: false };
};

describe('decideGradeScope', () => {
	test('a synced decision about one phase narrows the pass to that phase and everything it reaches', () => {
		const { params } = setupDecisionChange();

		const decision = decideGradeScope(params);

		// the row names the second phase, whose shared file reaches the first; the
		// third phase neither the decision nor its neighbour can reach is not read again
		expect(decision).toEqual(expect.objectContaining({ scope: 'focused', reuse: false, phases: ['phase1-core.md', 'phase2-extra.md'] }));
	});

	test('a changed decision whose reach cannot be placed decides full with that reason', () => {
		const { params, reachError } = setupDecisionChange({ namesNoPhase: true });

		const decision = decideGradeScope(params);

		// a row that names no phase may concern the whole plan, so nothing smaller
		// than the whole plan is a safe reading of it
		expect(decision).toEqual(
			expect.objectContaining({
				scope: 'full',
				reuse: false,
				phases: ['phase1-core.md', 'phase2-extra.md', 'phase3-solo.md'],
				reason: expect.stringContaining(reachError),
			}),
		);
	});

	test('a phased plan whose earlier pass recorded no decision-log part decides full', () => {
		const params = setupLegacyBaseline();

		const decision = decideGradeScope(params);

		// without the earlier pass's rows there is nothing to tell a changed row by,
		// and the missing history is never inferred from today's record
		expect(decision).toEqual(
			expect.objectContaining({
				scope: 'full',
				reuse: false,
				phases: ['phase1-core.md', 'phase2-extra.md', 'phase3-solo.md'],
				reason: expect.stringMatching(/no decision evidence/),
			}),
		);
	});

	test('a decision change together with an overview design edit decides full', () => {
		const { params } = setupDecisionChange({ designMoved: true });

		const decision = decideGradeScope(params);

		// the design edit is context every phase shares, so the phase the decision
		// names cannot stand in for everything the edit reaches
		expect(decision).toEqual(expect.objectContaining({ scope: 'full', reuse: false, phases: ['phase1-core.md', 'phase2-extra.md', 'phase3-solo.md'] }));
	});
});
