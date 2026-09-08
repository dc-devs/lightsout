import { describe, expect, test } from '@jest/globals';
import { GapArea, GapOutcome, type GradeFindingRecord, GradeFindingStatus, type GradeInputs, type GradeMemory, GradeScope } from '#src/contracts/index.ts';
import { decideGradeScope } from '#src/plan/common/scope/decideGradeScope.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { overviewBody, phaseBody } from '#tests/helpers/phasePlan.ts';

/** The one timestamp every fixture is stamped with — nothing here is decided by time. */
const passAt = '2026-01-01T00:00:00.000Z';

/**
 * A fingerprint with every non-plan-text input pinned, so a comparison between
 * two of these can only move on what a test actually varied. `probe` drops one
 * of the two git values entirely, which is not the same as setting it empty.
 */
const inputsFor = ({
	planFiles,
	sha256,
	probe = 'both',
}: {
	planFiles: { file: string; sha256: string }[];
	sha256: string;
	probe?: 'both' | 'no-commit' | 'no-changed-files';
}): GradeInputs => ({
	planFiles,
	...(probe === 'no-commit' ? {} : { gradedCommit: 'commit-abc' }),
	...(probe === 'no-changed-files' ? {} : { changedFiles: [{ path: 'src/core.ts', sha256: 'code-1' }] }),
	standards: 'standards-1',
	config: 'config-1',
	prompts: 'prompts-1',
	model: 'opus',
	effort: 'high',
	sha256,
});

/** One memory record. Only `status` and `phase` are read by the scope rules; the rest is what the contract demands of any record. */
const findingRecord = ({
	id,
	phase,
	status,
	disposition = GapOutcome.NeedsAHuman,
}: {
	id: string;
	phase: string;
	status: GradeFindingStatus;
	disposition?: typeof GapOutcome.NeedsAHuman | typeof GapOutcome.AgentCanDecide | typeof GapOutcome.AlreadyAnswered;
}): GradeFindingRecord => ({
	id,
	phase,
	area: GapArea.OmittedDecision,
	gap: 'The plan never says which store the token is read from.',
	decision: 'Name the store the token is read from.',
	options: ['the keychain', 'an environment variable'],
	firstSeen: passAt,
	lastSeen: passAt,
	status,
	disposition,
	humanDecision: 'Pick the store.',
	reopened: [],
});

/** The persisted memory, with the two baselines a test can supply one at a time. */
const memoryFor = ({
	findings,
	lastPass,
	lastPassingFullReview,
}: {
	findings: GradeFindingRecord[];
	lastPass?: GradeInputs;
	lastPassingFullReview?: GradeInputs;
}): GradeMemory => ({
	planName: 'demo',
	findings,
	...(lastPass === undefined ? {} : { lastPass: { scope: GradeScope.Full, inputs: lastPass, at: passAt } }),
	...(lastPassingFullReview === undefined ? {} : { lastPassingFullReview: { inputs: lastPassingFullReview, at: passAt } }),
	nextFindingNumber: findings.length + 1,
	updatedAt: passAt,
});

/** The two phase files a phased fixture uses: the first creates the shared file, the second modifies it. */
const phasedFiles = (): DeliverableFile[] => [
	{ path: '/plans/demo/phase1-core.md', text: phaseBody({ create: ['src/core.ts'], handsForward: '- `src/core.ts` exists.' }) },
	{ path: '/plans/demo/phase2-extra.md', text: phaseBody({ prerequisites: '- `src/core.ts` exists.', modify: ['src/core.ts'] }) },
];

/** The plan-file hashes of a phased fixture; the first phase's hash and the overview's are the two a test moves. */
const phasedPlanFiles = ({ phaseOne, overview = 'overview-1' }: { phaseOne: string; overview?: string }) => [
	{ file: 'overview.md', sha256: overview },
	{ file: 'phase1-core.md', sha256: phaseOne },
	{ file: 'phase2-extra.md', sha256: 'phase2-1' },
];

/** The third phase file, which shares no path, export or hand-off with the two above it — what keeps a focused closure short of the whole plan. */
const soloPhaseFile = (): DeliverableFile => ({ path: '/plans/demo/phase3-solo.md', text: phaseBody({ create: ['src/solo.ts'] }) });

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
 * open, both git probes read and every other input pinned — every condition a
 * focused pass needs at once, with a third phase sharing nothing so the closure
 * cannot reach the whole plan. Each knob turns off exactly one of those
 * conditions, so what a row asserts is what that knob did.
 */
const setupFocusable = ({ baseline = 'recorded', moved = 'nothing', twoPhases = false, narrowed = false }: FocusableSpec = {}) => {
	const files = twoPhases ? phasedFiles() : [...phasedFiles(), soloPhaseFile()];
	const soloRow = twoPhases ? [] : [{ number: 3, file: 'phase3-solo.md', creates: ['src/solo.ts'] }];
	const soloHash = twoPhases ? [] : [{ file: 'phase3-solo.md', sha256: 'phase3-1' }];
	const previous = inputsFor({ planFiles: [...phasedPlanFiles({ phaseOne: 'phase1-1' }), ...soloHash], sha256: 'inputs-previous' });
	const inputs = {
		...inputsFor({
			planFiles: [...phasedPlanFiles({ phaseOne: 'phase1-2', overview: moved === 'overview' ? 'overview-2' : 'overview-1' }), ...soloHash],
			sha256: 'inputs-current',
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

	return { files, overviewText: overviewBody({ rows }), memory, inputs, narrowed };
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
	const singlePrevious = inputsFor({ planFiles: [{ file: 'plan.md', sha256: 'plan-1' }], sha256: 'single-previous' });
	const single = {
		files: [{ path: '/plans/demo/plan.md', text: phaseBody({ create: ['src/core.ts'] }) }],
		memory: memoryFor({
			findings: [findingRecord({ id: 'f1', phase: 'plan.md', status: GradeFindingStatus.Open })],
			lastPass: singlePrevious,
		}),
		inputs: inputsFor({ planFiles: [{ file: 'plan.md', sha256: 'plan-2' }], sha256: 'single-current' }),
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

		// a single plan has no phase to narrow to, and a plan with every question
		// settled is not a repair check — approval needs the whole plan read
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
});
