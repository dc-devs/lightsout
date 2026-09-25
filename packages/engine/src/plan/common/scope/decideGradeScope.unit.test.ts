import { describe, expect, test } from '@jest/globals';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import { GradeFindingStatus } from '#src/contracts/plan/memory/GradeFindingStatus.ts';
import type { GradeReadCoverage } from '#src/contracts/plan/memory/GradeReadCoverage.ts';
import { decideGradeScope } from '#src/plan/common/scope/decideGradeScope.ts';
import { findingRecord, inputsFor, memoryFor, passAt, phasedFiles, phasedPlanFiles, planFileHashes, soloPhaseFile } from '#tests/helpers/gradeScopeInputs.ts';
import { overviewBody, phaseBody } from '#tests/helpers/phasePlan.ts';

/** One plan file's recorded reading, one entry per reader brief, at the design text `content` hashes to. */
const readingOf = ({ file, content, neighbours = [] }: { file: string; content: string; neighbours?: string[] }): GradeReadCoverage[] =>
	['surface', 'wiring', 'decisions'].map((lens) => ({ file, lens, designSha256: `${content}-design`, neighbours, at: passAt }));

interface FocusableSpec {
	/** What the memory holds of earlier passes: a recorded one, a passing full review over these very inputs, a memory with no pass, or no memory file at all. */
	baseline?: 'recorded' | 'reusable' | 'no-pass' | 'no-memory';
	/** The one input this pass moves besides the first phase's own text. */
	moved?: 'nothing' | 'overview' | 'standards';
	/** Drop the third phase, so the closure of the edited phase covers every file the plan has. */
	twoPhases?: boolean;
	narrowed?: boolean;
}

/**
 * A three-phase plan mid-repair: the first phase edited, one question still
 * open, both git probes read, every other input pinned and every plan file read
 * by the recorded pass at the text it had then — every condition a focused pass
 * needs at once, with a third phase sharing nothing so the closure cannot reach
 * the whole plan. Each knob turns off exactly one of those conditions, so what a
 * row asserts is what that knob did.
 */
const setupFocusable = ({ baseline = 'recorded', moved = 'nothing', twoPhases = false, narrowed = false }: FocusableSpec = {}) => {
	const files = twoPhases ? phasedFiles() : [...phasedFiles(), soloPhaseFile()];
	const soloRow = twoPhases ? [] : [{ number: 3, file: 'phase3-solo.md', creates: ['src/solo.ts'] }];
	const soloHash = twoPhases ? [] : [planFileHashes({ file: 'phase3-solo.md', content: 'phase3-1' })];
	const previous = inputsFor({ planFiles: [...phasedPlanFiles({ phaseOne: 'phase1-1' }), ...soloHash], sha256: 'inputs-previous' });
	const inputs = {
		...inputsFor({
			planFiles: [...phasedPlanFiles({ phaseOne: 'phase1-2', overview: moved === 'overview' ? 'overview-2' : 'overview-1' }), ...soloHash],
			sha256: 'inputs-current',
			design: moved === 'overview' ? 'design-2' : 'design-1',
		}),
		...(moved === 'standards' ? { standards: 'standards-2' } : {}),
	};
	const findings = [findingRecord({ id: 'f1', phase: 'phase1-core.md', status: GradeFindingStatus.Open })];
	const memory =
		baseline === 'no-memory'
			? undefined
			: memoryFor({
					findings,
					lastPass: baseline === 'no-pass' ? undefined : previous,
					lastPassingFullReview: baseline === 'reusable' ? inputs : undefined,
				});
	const rows = [{ number: 1, file: 'phase1-core.md', creates: ['src/core.ts'] }, { number: 2, file: 'phase2-extra.md' }, ...soloRow];
	// The recorded pass read all three at the text the baseline fingerprint holds,
	// so the only file whose reading no longer stands is the one a knob moves.
	const readers = [
		...readingOf({ file: 'phase1-core.md', content: 'phase1-1', neighbours: ['phase2-extra.md'] }),
		...readingOf({ file: 'phase2-extra.md', content: 'phase2-1', neighbours: ['phase1-core.md'] }),
		...(twoPhases ? [] : readingOf({ file: 'phase3-solo.md', content: 'phase3-1' })),
	];

	return { files, overviewText: overviewBody({ rows }), memory: memory === undefined ? undefined : { ...memory, coverage: { readers } }, inputs, narrowed };
};

/**
 * A two-phase plan whose overview declares only the first phase. Everything a
 * focused pass needs is in place — an edited phase, an open record, both git
 * probes read and no other input moved — so the only rule left to fire is the
 * one that cannot build the phase graph.
 */
const setupUndeclaredPhase = () => {
	const overviewText = overviewBody({ rows: [{ number: 1, file: 'phase1-core.md', creates: ['src/core.ts'] }] });
	const previous = inputsFor({ planFiles: phasedPlanFiles({ phaseOne: 'phase1-1' }), sha256: 'inputs-previous' });
	const inputs = inputsFor({ planFiles: phasedPlanFiles({ phaseOne: 'phase1-2' }), sha256: 'inputs-current' });
	const memory = memoryFor({
		findings: [findingRecord({ id: 'f1', phase: 'phase1-core.md', status: GradeFindingStatus.Open })],
		lastPass: previous,
	});

	return { files: phasedFiles(), overviewText, memory, inputs, narrowed: false };
};

/**
 * Two plans that must both be reviewed whole for different reasons: one has a
 * single plan file and no phases to narrow to, and the other has phases but not
 * one unresolved question a focused pass could exist to check.
 */
const setupFullByStructure = () => {
	const singlePrevious = inputsFor({ planFiles: [planFileHashes({ file: 'plan.md', content: 'plan-1' })], sha256: 'single-previous' });
	const single = {
		files: [{ path: '/plans/demo/plan.md', text: phaseBody({ create: ['src/core.ts'] }) }],
		memory: memoryFor({
			findings: [findingRecord({ id: 'f1', phase: 'plan.md', status: GradeFindingStatus.Open })],
			lastPass: singlePrevious,
		}),
		inputs: inputsFor({ planFiles: [planFileHashes({ file: 'plan.md', content: 'plan-2' })], sha256: 'single-current' }),
		narrowed: false,
	};

	const nothingOpenPrevious = inputsFor({ planFiles: phasedPlanFiles({ phaseOne: 'phase1-1' }), sha256: 'settled-previous' });
	const nothingOpen = {
		files: phasedFiles(),
		overviewText: overviewBody({
			rows: [
				{ number: 1, file: 'phase1-core.md', creates: ['src/core.ts'] },
				{ number: 2, file: 'phase2-extra.md' },
			],
		}),
		memory: memoryFor({
			findings: [
				findingRecord({ id: 'f1', phase: 'phase1-core.md', status: GradeFindingStatus.Resolved }),
				findingRecord({ id: 'f2', phase: 'phase2-extra.md', status: GradeFindingStatus.Noted, disposition: GapOutcome.AgentCanDecide }),
			],
			lastPass: nothingOpenPrevious,
		}),
		inputs: inputsFor({ planFiles: phasedPlanFiles({ phaseOne: 'phase1-2' }), sha256: 'settled-current' }),
		narrowed: false,
	};

	return { single, nothingOpen };
};

/**
 * The same focusable two-phase plan twice, once with the commit probe unread and
 * once with the changed-file probe unread. Both carry a recorded passing full
 * review whose fingerprint equals the current one, so a rule that read the git
 * state as evidence would reuse it.
 */
const setupUnreadProbe = () => {
	const overviewText = overviewBody({
		rows: [
			{ number: 1, file: 'phase1-core.md', creates: ['src/core.ts'] },
			{ number: 2, file: 'phase2-extra.md' },
		],
	});
	const previous = inputsFor({ planFiles: phasedPlanFiles({ phaseOne: 'phase1-1' }), sha256: 'inputs-previous' });
	const recorded = inputsFor({ planFiles: phasedPlanFiles({ phaseOne: 'phase1-2' }), sha256: 'inputs-current' });
	const memory = memoryFor({
		findings: [findingRecord({ id: 'f1', phase: 'phase1-core.md', status: GradeFindingStatus.Open })],
		lastPass: previous,
		lastPassingFullReview: recorded,
	});
	const shared = { files: phasedFiles(), overviewText, memory, narrowed: false };

	return {
		noCommit: { ...shared, inputs: inputsFor({ planFiles: phasedPlanFiles({ phaseOne: 'phase1-2' }), sha256: 'inputs-current', probe: 'no-commit' }) },
		noChangedFiles: {
			...shared,
			inputs: inputsFor({ planFiles: phasedPlanFiles({ phaseOne: 'phase1-2' }), sha256: 'inputs-current', probe: 'no-changed-files' }),
		},
	};
};

/** The three rows a three-phase overview declares: the two that share `src/core.ts` and the one that shares nothing. */
const threePhaseRows = [
	{ number: 1, file: 'phase1-core.md', creates: ['src/core.ts'] },
	{ number: 2, file: 'phase2-extra.md' },
	{ number: 3, file: 'phase3-solo.md', creates: ['src/solo.ts'] },
];

/**
 * A three-phase plan with every question settled and a recorded reading of all
 * three files, of which only the third has since been rewritten. Nothing a
 * focused pass used to need is present — no finding is open — so what narrows
 * this pass is the coverage alone, and the rewritten phase shares nothing with
 * the other two, so its closure cannot reach them.
 *
 * `rewritten` false leaves the third phase at the text it was read at too, so no
 * plan file's coverage falls and the pass owes no reading at all.
 */
const setupCoverageNarrowed = ({ rewritten = true }: { rewritten?: boolean } = {}) => {
	const files = [...phasedFiles(), soloPhaseFile()];
	const planFiles = ({ phaseThree }: { phaseThree: string }) => [
		...phasedPlanFiles({ phaseOne: 'phase1-1' }),
		planFileHashes({ file: 'phase3-solo.md', content: phaseThree }),
	];
	const previous = inputsFor({ planFiles: planFiles({ phaseThree: 'phase3-1' }), sha256: 'inputs-previous' });
	const inputs = inputsFor({ planFiles: planFiles({ phaseThree: rewritten ? 'phase3-2' : 'phase3-1' }), sha256: 'inputs-current' });
	const readers = [
		...readingOf({ file: 'phase1-core.md', content: 'phase1-1', neighbours: ['phase2-extra.md'] }),
		...readingOf({ file: 'phase2-extra.md', content: 'phase2-1', neighbours: ['phase1-core.md'] }),
		...readingOf({ file: 'phase3-solo.md', content: 'phase3-1' }),
	];
	const settled = memoryFor({
		findings: [
			findingRecord({ id: 'f1', phase: 'phase1-core.md', status: GradeFindingStatus.Resolved }),
			findingRecord({ id: 'f2', phase: 'phase2-extra.md', status: GradeFindingStatus.Noted, disposition: GapOutcome.AgentCanDecide }),
		],
		lastPass: previous,
	});

	return { files, overviewText: overviewBody({ rows: threePhaseRows }), memory: { ...settled, coverage: { readers } }, inputs, narrowed: false };
};

/**
 * The same three-phase plan mid-repair, whose recorded reading was taken at text
 * every one of the three files has since moved away from. Every other condition
 * a focused pass needs is in place, so the only thing left to decide the scope
 * is that no file's coverage stands.
 */
const setupNoStandingCoverage = () => {
	const files = [...phasedFiles(), soloPhaseFile()];
	const planFiles = ({ phaseOne }: { phaseOne: string }) => [...phasedPlanFiles({ phaseOne }), planFileHashes({ file: 'phase3-solo.md', content: 'phase3-1' })];
	const previous = inputsFor({ planFiles: planFiles({ phaseOne: 'phase1-1' }), sha256: 'inputs-previous' });
	const inputs = inputsFor({ planFiles: planFiles({ phaseOne: 'phase1-2' }), sha256: 'inputs-current' });
	const readers = [
		...readingOf({ file: 'phase1-core.md', content: 'phase1-0', neighbours: ['phase2-extra.md'] }),
		...readingOf({ file: 'phase2-extra.md', content: 'phase2-0', neighbours: ['phase1-core.md'] }),
		...readingOf({ file: 'phase3-solo.md', content: 'phase3-0' }),
	];
	const repairing = memoryFor({
		findings: [findingRecord({ id: 'f1', phase: 'phase1-core.md', status: GradeFindingStatus.Open })],
		lastPass: previous,
	});

	return { files, overviewText: overviewBody({ rows: threePhaseRows }), memory: { ...repairing, coverage: { readers } }, inputs, narrowed: false };
};

describe('decideGradeScope', () => {
	test('an unresolvable phase graph decides full rather than focused', () => {
		const params = setupUndeclaredPhase();

		const decision = decideGradeScope(params);

		// narrowing to a closure the graph could not build would silently leave a
		// phase unread, which is the forgotten-blocker failure this rule exists for
		expect(decision).toEqual(
			expect.objectContaining({
				scope: 'full',
				reuse: false,
				phases: ['phase1-core.md', 'phase2-extra.md'],
				reason: expect.stringContaining('phase2-extra.md'),
			}),
		);
	});

	test('a single plan and a plan with nothing open both decide full', () => {
		const { single, nothingOpen } = setupFullByStructure();

		const singleDecision = decideGradeScope(single);
		const nothingOpenDecision = decideGradeScope(nothingOpen);

		// a single plan has no phase to narrow to, and the settled plan holds no
		// recorded reading at all, so every one of its files is owed one
		expect({
			single: { scope: singleDecision.scope, reuse: singleDecision.reuse },
			nothingOpen: { scope: nothingOpenDecision.scope, reuse: nothingOpenDecision.reuse },
		}).toStrictEqual({ single: { scope: 'full', reuse: false }, nothingOpen: { scope: 'full', reuse: false } });
	});

	test('a fingerprint with an unread git probe decides full and refuses reuse', () => {
		const { noCommit, noChangedFiles } = setupUnreadProbe();

		const noCommitDecision = decideGradeScope(noCommit);
		const noChangedFilesDecision = decideGradeScope(noChangedFiles);

		// an unread probe is not evidence the code is unchanged, so neither the
		// recorded passing review nor the edited-phase closure may be trusted
		expect({
			noCommit: { scope: noCommitDecision.scope, reuse: noCommitDecision.reuse },
			noChangedFiles: { scope: noChangedFilesDecision.scope, reuse: noChangedFilesDecision.reuse },
		}).toStrictEqual({ noCommit: { scope: 'full', reuse: false }, noChangedFiles: { scope: 'full', reuse: false } });
	});

	test('a repaired phase narrows the pass to itself and the phases it reaches', () => {
		const params = setupFocusable();

		const decision = decideGradeScope(params);

		// the repaired phase and the phase that shares its file are read; the phase
		// no repair to either can reach is not paid for a second time
		expect(decision).toEqual(
			expect.objectContaining({
				scope: 'focused',
				reuse: false,
				phases: ['phase1-core.md', 'phase2-extra.md'],
				reason: expect.stringContaining('phase2-extra.md'),
			}),
		);
	});

	test('a recorded passing full review over these very inputs is reported as current', () => {
		const params = setupFocusable({ baseline: 'reusable' });

		const decision = decideGradeScope(params);

		// nothing that review measured has moved, so running it again would buy the
		// same verdict a second time
		expect(decision).toEqual(expect.objectContaining({ scope: 'full', reuse: true, phases: ['phase1-core.md', 'phase2-extra.md', 'phase3-solo.md'] }));
	});

	test('a --phase narrowing is left exactly as the human typed it', () => {
		const params = setupFocusable({ narrowed: true });

		const decision = decideGradeScope(params);

		// the engine's own scope rule replaces nothing a human chose, and a narrowed
		// pass is never reused either
		expect(decision).toEqual(expect.objectContaining({ scope: 'full', reuse: false, reason: expect.stringContaining('--phase') }));
	});

	test.each([
		{ label: 'no memory file at all', baseline: 'no-memory' as const },
		{ label: 'a memory holding no earlier pass', baseline: 'no-pass' as const },
	])('a pass with $label reviews the whole plan', ({ baseline }) => {
		const params = setupFocusable({ baseline });

		const decision = decideGradeScope(params);

		// with no earlier reading to compare the plan text against, there is no
		// edited set for a closure to grow from
		expect(decision).toEqual(expect.objectContaining({ scope: 'full', reuse: false }));
	});

	test('a moved standards text sends the pass back over the whole plan', () => {
		const params = setupFocusable({ moved: 'standards' });

		const decision = decideGradeScope(params);

		// the recorded reading was taken against different standards, so it no
		// longer speaks for this pass at all
		expect(decision).toEqual(expect.objectContaining({ scope: 'full', reuse: false }));
	});

	test('an edited overview sends the pass back over the whole plan', () => {
		const params = setupFocusable({ moved: 'overview' });

		const decision = decideGradeScope(params);

		// the overview is context every phase shares, and the closure of the edited
		// phases cannot bound what a change to it reaches
		expect(decision).toEqual(expect.objectContaining({ scope: 'full', reuse: false, phases: ['phase1-core.md', 'phase2-extra.md', 'phase3-solo.md'] }));
	});

	test('a closure that already covers every plan file is a full pass by another name', () => {
		const params = setupFocusable({ twoPhases: true });

		const decision = decideGradeScope(params);

		// calling it focused would make it incomplete by construction, and a pass
		// that did offer the readers every file is one that can approve
		expect(decision).toEqual(expect.objectContaining({ scope: 'full', reuse: false, phases: ['phase1-core.md', 'phase2-extra.md'] }));
	});

	test('a plan with nothing open still narrows to the plan files whose coverage fell', () => {
		const params = setupCoverageNarrowed();

		const decision = decideGradeScope(params);

		// the two files still covered at their current text were already read and
		// paid for; a pass with nothing open is no reason to buy them again
		expect(decision).toEqual(
			expect.objectContaining({
				scope: 'focused',
				reuse: false,
				phases: ['phase3-solo.md'],
				reason: expect.stringContaining('phase3-solo.md'),
			}),
		);
	});

	test('a plan covered at its current text everywhere owes no reading and says so', () => {
		const params = setupCoverageNarrowed({ rewritten: false });

		const decision = decideGradeScope(params);

		// this is what the record is for: a pass that reads nothing at all is still
		// entitled to approve, so the empty list has to be reported as coverage
		// standing rather than left as a list a reader cannot account for
		expect(decision).toEqual(
			expect.objectContaining({
				scope: 'focused',
				reuse: false,
				phases: [],
				reason: expect.stringContaining('every plan file is covered at its current text'),
			}),
		);
	});

	test('coverage that stands for no plan file decides full rather than focused', () => {
		const params = setupNoStandingCoverage();

		const decision = decideGradeScope(params);

		// a pass that reads every plan file is a full review whatever narrowed it,
		// and recording it as a repair check would leave the plan unable to approve
		expect(decision).toEqual(expect.objectContaining({ scope: 'full', reuse: false, phases: ['phase1-core.md', 'phase2-extra.md', 'phase3-solo.md'] }));
	});
});
